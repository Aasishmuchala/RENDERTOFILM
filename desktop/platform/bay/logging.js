// @runway/bay/logging — a console-backed logger.
export function createLogger(name = 'app') {
  const tag = `[${name}]`;
  return {
    debug: (...a) => console.debug(tag, ...a),
    info: (...a) => console.info(tag, ...a),
    warn: (...a) => console.warn(tag, ...a),
    error: (...a) => console.error(tag, ...a),
  };
}
export const logger = createLogger();
