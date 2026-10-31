import type Koa from 'koa';

export declare const STORAGE_UPLOAD_FAILURE_HINT: string;
export declare const SEALED_PREFIXES: readonly string[];
export declare function assertSafeKey(key: string): void;
export declare function storagePath(key: string): string;
export declare function isSealedKey(key: string): boolean;

export interface DocumentStore<T> {
  get(key: string): Promise<{ value: T } | null>;
  update(key: string, fn: (current: T | undefined) => T | Promise<T>): Promise<T>;
  delete(key: string): Promise<void>;
}
export declare function documentStore<T>(options: { prefix: string }): DocumentStore<T>;

export interface StorageWriteOptions {
  contentType?: string;
  test?: boolean;
  [k: string]: unknown;
}
export declare function putObject(
  key: string,
  body: string | Uint8Array | Buffer,
  opts?: StorageWriteOptions
): Promise<void>;
export declare function getObject(key: string): Promise<Buffer | null>;
export declare function deleteObject(key: string): Promise<void>;
export declare function list(
  prefix?: string
): Promise<{ objects: { key: string }[]; folders: string[] }>;
export declare function presignUpload(
  key: string,
  opts?: StorageWriteOptions
): Promise<{ url: string }>;
export declare function mediaRedirect(
  // `any`: the real ctx is a @koa/router context carrying `params`.
  keyFromCtx: (ctx: any) => string | undefined
): Koa.Middleware<any, any>;
export declare function headObject(
  key: string
): Promise<{ size: number; lastModified: Date } | null>;
export declare function presignGet(
  key: string,
  opts?: { expiresIn?: number; contentType?: string; [k: string]: unknown }
): Promise<string>;
