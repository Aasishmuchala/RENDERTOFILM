import type Koa from 'koa';
import type { Server } from 'node:http';

export type BayContext = Koa.Context;

export declare class BayApp {
  constructor(options?: Record<string, unknown>);
  readonly koa: Koa;
  use(middleware: Koa.Middleware): this;
  get(path: string, handler: Koa.Middleware): this;
  start(port?: number): Server;
}
