// Keys at rest. The connections/ documents are sealed with AES-256-GCM under a
// 32-byte data key: main keeps it wrapped by Electron's safeStorage and hands
// it over at boot; the harness and CI pass RTF_SECRET_KEY or get a dev key file.
// Nothing here logs a key, and no error carries a key or part of a document.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ALG = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

/** Shown to the visitor as is (`expose`), so a message never holds anything secret. */
export class SecretsError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SecretsError';
    this.status = 409;
    this.expose = true;
  }
}

function assertKey(key) {
  if (!Buffer.isBuffer(key) || key.length !== KEY_BYTES) throw new SecretsError('invalid key');
}

/** Whether a parsed JSON document is a sealed envelope. */
export function isSealed(doc) {
  return doc?.alg === ALG;
}

export function seal(key, obj) {
  assertKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALG, key, iv, { authTagLength: TAG_BYTES });
  const data = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  return {
    v: 1,
    alg: ALG,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

export function open(key, sealed) {
  assertKey(key);
  if (!isSealed(sealed) || sealed.v !== 1) throw new SecretsError('not a sealed document');
  if (![sealed.iv, sealed.tag, sealed.data].every((part) => typeof part === 'string')) {
    throw new SecretsError('not a sealed document');
  }
  let text;
  try {
    // `authTagLength` pins the tag: without it GCM accepts a tag cut down to 4 bytes.
    const decipher = createDecipheriv(ALG, key, Buffer.from(sealed.iv, 'base64'), { authTagLength: TAG_BYTES });
    decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
    text = Buffer.concat([decipher.update(Buffer.from(sealed.data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    throw new SecretsError('wrong key');
  }
  try {
    return JSON.parse(text);
  } catch {
    // Not the parser's own error: it quotes the text it could not read.
    throw new SecretsError('corrupt document');
  }
}

/** The 32-byte key from 64 hex characters. */
export function keyFromHex(hex) {
  if (typeof hex !== 'string' || !/^[0-9a-f]{64}$/i.test(hex)) {
    throw new SecretsError('secret key must be 64 hex characters');
  }
  return Buffer.from(hex, 'hex');
}

/**
 * The harness's key, kept in `<dataDir>/dev-secret.key` (created 0600 once). A
 * file that is not a key is refused rather than replaced: replacing it would
 * orphan everything sealed under it.
 */
export function devKeyFile(dataDir) {
  const file = path.join(dataDir, 'dev-secret.key');
  console.warn(`[desktop] using a development secret key at ${file}; keys are not protected by the OS keychain`);
  fs.mkdirSync(dataDir, { recursive: true });
  try {
    fs.writeFileSync(file, randomBytes(KEY_BYTES).toString('hex'), { flag: 'wx', mode: 0o600 });
  } catch (err) {
    if (err?.code !== 'EEXIST') throw err;
  }
  return keyFromHex(fs.readFileSync(file, 'utf8').trim());
}
