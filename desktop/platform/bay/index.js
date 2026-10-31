// @runway/bay — a minimal BayApp: a Koa app with runwayAuth mounted and the
// health probe Bay expects. The app under test uses raw Koa, so this exists
// only so the root export resolves.
import Koa from 'koa';
import { runwayAuth } from './runway.js';

export class BayApp {
  constructor(options = {}) {
    this.options = options;
    this.koa = new Koa();
    this.koa.proxy = true;
    this.routes = new Map();
    this.koa.use(async (ctx, next) => {
      if (ctx.path === '/__bay/health') {
        ctx.body = 'ok';
        return;
      }
      await next();
    });
    this.koa.use(runwayAuth({ optional: true }));
    this.koa.use(async (ctx, next) => {
      const handler = ctx.method === 'GET' ? this.routes.get(ctx.path) : undefined;
      if (handler) return handler(ctx, next);
      await next();
    });
  }
  use(middleware) {
    this.koa.use(middleware);
    return this;
  }
  get(path, handler) {
    this.routes.set(path, handler);
    return this;
  }
  start(port = Number(process.env.PORT ?? 3000)) {
    const server = this.koa.listen(port, () => console.log(`Listening on port ${port}`));
    server.keepAliveTimeout = 120_000;
    server.headersTimeout = 125_000;
    return server;
  }
}
