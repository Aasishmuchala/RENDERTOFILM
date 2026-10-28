/** From https://github.com/BlairCurrey/trpc-koa-adapter/blob/master/src/index.ts */
import type { AnyRouter } from '@trpc/server';
import {
  type NodeHTTPCreateContextFnOptions,
  type NodeHTTPHandlerOptions,
  type NodeHTTPRequestHandlerOptions,
  nodeHTTPRequestHandler,
} from '@trpc/server/adapters/node-http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Middleware } from 'koa';

export type CreateTrpcKoaContextOptions = NodeHTTPCreateContextFnOptions<
  IncomingMessage,
  ServerResponse<IncomingMessage>
>;
export type AdditionalMiddlewareOpts = { prefix?: `/${string}` };
export type CreateKoaMiddlewareOptions<TRouter extends AnyRouter> =
  NodeHTTPHandlerOptions<
    TRouter,
    IncomingMessage,
    ServerResponse<IncomingMessage>
  > &
    AdditionalMiddlewareOpts;

export const createKoaMiddleware =
  <TRouter extends AnyRouter>(
    opts: CreateKoaMiddlewareOptions<TRouter>
  ): Middleware =>
  async (ctx, next) => {
    // `prefix` stays local — nodeHTTPRequestHandler has no such option.
    // Everything else is forwarded so callers can pass any handler option
    // (e.g. `allowMethodOverride`), not just router/createContext.
    const { prefix, ...handlerOpts } = opts;
    const { req, res, request } = ctx;

    if (prefix && !request.path.startsWith(prefix)) return next();

    // koa uses 404 as a default status but some logic in
    // nodeHTTPRequestHandler assumes default status of 200.
    res.statusCode = 200;

    // `...handlerOpts`'s optional properties (e.g. `responseMeta`) come out
    // typed with an explicit `| undefined` that `exactOptionalPropertyTypes`
    // then rejects on this literal (TS2379). The cast is exact — this literal
    // already satisfies the handler's real parameter type — so it only drops
    // that spurious `| undefined`, it does not widen or hide a real mismatch.
    await nodeHTTPRequestHandler({
      // Default, not a floor: a caller-supplied onError in `opts` wins.
      onError: (err) => {
        console.error(err.error);
      },
      ...handlerOpts,
      createContext: handlerOpts.createContext!,
      req,
      res,
      path: request.path.slice((prefix?.length ?? 0) + 1),
    } as NodeHTTPRequestHandlerOptions<
      TRouter,
      IncomingMessage,
      ServerResponse<IncomingMessage>
    >);
  };
