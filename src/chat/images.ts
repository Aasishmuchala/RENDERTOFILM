// The pictures a chat sends the model. A thread is rewritten on every token and
// step, so it keeps only each picture's key, and the bytes are read and encoded
// when a request is built.
import { imageSlot, MAX_INPUT_PIXELS, sharp } from '../imaging.ts';
import { getObject } from '../storage.ts';
import type { Message } from './domain.ts';

const LONG_EDGE = 1920;
const JPEG_QUALITY = 85;
/** Encoded pictures kept in memory: every model call of a Turn sends them all again. */
const KEPT = 64;

const made = new Map<string, Promise<unknown>>();

export const imageRef = (key: string) => ({ type: 'image_ref', key });

const isRef = (block: unknown): block is { type: 'image_ref'; key: string } =>
  (block as { type?: unknown } | null)?.type === 'image_ref';

async function encode(key: string): Promise<unknown> {
  const stored = await getObject(key);
  if (!stored) throw new Error('That file is no longer there.');
  const jpeg = await imageSlot(() =>
    sharp(Buffer.from(stored), { limitInputPixels: MAX_INPUT_PIXELS })
      .autoOrient()
      .resize({ width: LONG_EDGE, height: LONG_EDGE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer()
  );
  return { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpeg.toString('base64') } };
}

/** The block the model reads a picture by. Rejects on a file that is gone or is no picture. */
export function imageBlockOf(key: string): Promise<unknown> {
  const known = made.get(key);
  if (known) return known;
  const block = encode(key);
  block.catch(() => made.delete(key));
  made.set(key, block);
  if (made.size > KEPT) made.delete(made.keys().next().value!);
  return block;
}

/** The thread's messages as the model reads them. A picture that has gone becomes a line saying so. */
export async function withImages(messages: Message[]): Promise<Message[]> {
  const out: Message[] = [];
  // One at a time: a message can hold 24 renders.
  for (const message of messages) {
    const content: unknown[] = [];
    for (const block of message.content) {
      if (!isRef(block)) content.push(block);
      else content.push(await imageBlockOf(block.key).catch(() => ({ type: 'text', text: '[This picture is no longer available.]' })));
    }
    out.push({ ...message, content });
  }
  return out;
}
