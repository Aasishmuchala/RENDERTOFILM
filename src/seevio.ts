/**
 * Seevio (https://seevio.ai/docs): a Bearer API key against
 * `https://api.seevio.ai`. Generations return a `taskId` at once; poll
 * `GET /v1/tasks/{taskId}` (every 10–20s, backing off on 429) until it is
 * `completed` or `failed`. The key belongs to the person who pasted it in
 * Settings — their Seevio credits, not the app owner's.
 */

export const SEEVIO_BASE_URL = 'https://api.seevio.ai';
const TIMEOUT_MS = 20_000;

export class SeevioError extends Error {
  readonly expose = true;
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'SeevioError';
    this.status = status;
  }
}

async function seevioFetch(key: string, path: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(`${SEEVIO_BASE_URL}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${key}`,
        accept: 'application/json',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...init.headers,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new SeevioError("Couldn't reach Seevio. Try again in a moment.", 422);
  }
}

/**
 * Whether Seevio accepts the key. There is no "who am I" route, so this asks
 * for a task that cannot exist: a valid key gets 404 (not yours / not found),
 * a bad one 401 or 403.
 */
export async function verifySeevioKey(key: string): Promise<void> {
  const res = await seevioFetch(key, '/v1/tasks/render-to-film-key-check');
  await res.body?.cancel();
  if (res.status === 401 || res.status === 403) {
    throw new SeevioError('Seevio refused that API key. Check it and paste it again.', 400);
  }
  if (res.status >= 500) {
    throw new SeevioError(`Seevio answered ${res.status}. Try again in a moment.`, 422);
  }
}

export interface SeevioTask {
  taskId: string;
  status?: string;
  [key: string]: unknown;
}

/** Starts a video generation (e.g. `{ model: 'seedance-2-5', prompt, ... }`). */
export async function createSeevioVideo(key: string, body: Record<string, unknown>): Promise<SeevioTask> {
  const res = await seevioFetch(key, '/v1/videos/generations', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new SeevioError(
      `Seevio refused the generation (${res.status})${text ? `: ${text.slice(0, 200)}` : '.'}`,
      res.status === 401 || res.status === 403 ? 400 : 422
    );
  }
  return (await res.json()) as SeevioTask;
}

export async function getSeevioTask(key: string, taskId: string): Promise<SeevioTask> {
  const res = await seevioFetch(key, `/v1/tasks/${encodeURIComponent(taskId)}`);
  if (res.status === 404) {
    await res.body?.cancel();
    throw new SeevioError('Seevio has no task with that id on this key.', 404);
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new SeevioError(`Seevio answered ${res.status} for that task.`, res.status === 429 ? 429 : 422);
  }
  return (await res.json()) as SeevioTask;
}
