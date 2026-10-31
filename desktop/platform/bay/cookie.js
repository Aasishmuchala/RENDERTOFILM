// @runway/bay/runway/cookie — reads the payload of a session JWT, unverified.
export function decodeJwtPayload(token) {
  try {
    const part = String(token).split('.')[1];
    if (!part) return null;
    const json = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return json && typeof json === 'object' ? json : null;
  } catch {
    return null;
  }
}
