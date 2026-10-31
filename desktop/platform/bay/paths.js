// Where the platform keeps its files, and the absolute URLs it hands out.
// The data folder comes from RTF_DATA_DIR (the harness's dev.mjs and the
// desktop app both set it) and is required; the assets ship beside this
// folder unless RTF_ASSETS_DIR says otherwise (a packaged app's resources).
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DATA_DIR = path.resolve(
  process.env.RTF_DATA_DIR ??
    (() => {
      throw new Error('RTF_DATA_DIR is not set');
    })()
);
export const ASSETS_DIR = path.resolve(
  process.env.RTF_ASSETS_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '../assets')
);
export const STORAGE_DIR = path.join(DATA_DIR, 'storage');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

/** `http://localhost:<PORT>` of the API process (PORT is read per call). */
export function mockOrigin() {
  return `http://localhost:${process.env.PORT ?? 3000}`;
}
