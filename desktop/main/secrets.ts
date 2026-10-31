// The data key that seals the connections/ documents (platform/bay/secrets.js).
// It is made once, kept wrapped by the OS (Keychain, DPAPI) in
// <userData>/data-key.sealed, and reaches the server only over its MessagePort.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { safeStorage } from 'electron';

const HEX_KEY = /^[0-9a-f]{64}$/;

/** Thrown when the key cannot be read or made; its message is shown as is. */
export class DataKeyError extends Error {}

async function store(file: string, key: string) {
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, (await safeStorage.encryptStringAsync(key)).toString('base64'), { mode: 0o600 });
  renameSync(temporary, file);
}

/**
 * The hex data key. A key that exists but will not open stops the launch: making
 * a new one would strand every saved connection under the old.
 */
export async function dataKey(userData: string): Promise<string> {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) {
    throw new DataKeyError('This computer has no secure place to keep your keys.');
  }
  const file = path.join(userData, 'data-key.sealed');
  if (!existsSync(file)) {
    const key = randomBytes(32).toString('hex');
    await store(file, key);
    return key;
  }
  let opened: { shouldReEncrypt: boolean; result: string };
  try {
    opened = await safeStorage.decryptStringAsync(Buffer.from(readFileSync(file, 'utf8'), 'base64'));
  } catch {
    throw new DataKeyError('Render to Film could not unlock your saved keys. Allow it in the system prompt and open it again.');
  }
  if (!HEX_KEY.test(opened.result)) throw new DataKeyError('Your saved key file is damaged.');
  if (opened.shouldReEncrypt) await store(file, opened.result);
  return opened.result;
}
