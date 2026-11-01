import type { IncomingMessage, ServerResponse } from 'node:http';
import type Koa from 'koa';

export interface RunwayProfile {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
  picture?: string | null;
}

export interface TaskSnapshot {
  id: string;
  done: boolean;
  status: 'PENDING' | 'THROTTLED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED';
  progress?: number;
  url?: string;
  error?: string;
  hint?: string;
  text?: string;
  truncated?: boolean;
}

export type BayViewerKind = 'member' | 'guest' | 'anonymous';

export interface TaskArtifact {
  id: string;
  url: string;
  isDirectory?: boolean;
  metadata?: { duration?: number; frameRate?: number; size?: { width?: number; height?: number } };
}

/** What a task would cost. `amount` is null when the provider cannot say; `note` then says why or gives its rate line. */
export interface TaskQuote {
  unit: 'credits' | 'usd';
  amount: number | null;
  note?: string;
}

export declare class RunwayClient {
  constructor(owner?: string);
  /** Desktop only: the owner's provider row. Absent on the plain harness, which capabilitiesOf() reads as Bay. */
  capabilities?(): unknown;
  /** Desktop only: the owner's provider prices a task. Absent on the plain harness, as it is on Bay. */
  quote?(type: string, options?: Record<string, unknown>): Promise<TaskQuote>;
  ready(): Promise<void>;
  getProfile(): Promise<RunwayProfile>;
  createTask(
    type: string,
    options: Record<string, unknown>,
    opts?: { internal?: boolean }
  ): Promise<{ id: string }>;
  taskSnapshot(id: string, opts?: { includeText?: boolean }): Promise<TaskSnapshot>;
  getTask(
    id: string
  ): Promise<{ id: string; status: TaskSnapshot['status']; artifacts: TaskArtifact[] }>;
  uploadAsset(bytes: Buffer, opts: { filename: string; signal?: AbortSignal }): Promise<{ url: string }>;
  runTask(
    type: string,
    options: Record<string, unknown>
  ): Promise<{ artifacts: TaskArtifact[] }>;
}

declare module 'koa' {
  interface DefaultState {
    runway?: RunwayClient;
    viewer?: BayViewerKind;
  }
}

export declare const SIGN_IN_REQUIRED: 'sign_in_required';
export declare const LOCAL_PROFILE: RunwayProfile;
export declare const LOCAL_OWNER: string;

export declare function runwayAuth(options?: { optional?: boolean }): Koa.Middleware;
export declare function requireRunwayUser(): Koa.Middleware;
/**
 * The tRPC context for work no request started, as the one local owner. Typed as
 * src/trpc.ts's Context so a caller takes it; at run time `res` is undefined and
 * `req` holds only the client, which is all a procedure reads through ownerKey.
 */
export declare function localContext(): {
  req: IncomingMessage;
  res: ServerResponse<IncomingMessage>;
  user: undefined;
  runway: RunwayClient;
  viewer: BayViewerKind;
  signInUrl: string;
};
export declare function getRunwayClient(req: IncomingMessage): RunwayClient | undefined;
export declare function getRunwayToken(req: IncomingMessage): string | undefined;
export declare function getBayViewer(req: IncomingMessage): BayViewerKind | undefined;
export declare function getRunwaySignInUrl(req: IncomingMessage): string;
export declare function runwayAuthGated(req: IncomingMessage): boolean;
export declare function runwayCreditsRequired(err: unknown): { credits: number };

export declare class RunwayApiError extends Error {
  constructor(message: string, options?: { status?: number; body?: unknown });
  readonly status: number;
  readonly body: unknown;
}
export declare class RunwayBrokerError extends RunwayApiError {
  constructor(message: string, options: { code: string; consentUrl?: string; status?: number; body?: unknown });
  readonly code: string;
  readonly consentUrl?: string;
}
export declare class RunwayCreditError extends Error {
  constructor(message: string, options?: { reason?: string });
  readonly reason?: string;
}
export declare class RunwayAuthError extends Error {
  constructor(message: string, options?: { permissionDenied?: boolean; reason?: string });
  readonly permissionDenied: boolean;
  readonly reason?: string;
}
export declare class RunwayTaskError extends RunwayApiError {
  constructor(
    message: string,
    options: {
      status: number;
      body?: unknown;
      issues?: { path: (string | number)[]; message: string }[];
    }
  );
  readonly status: number;
  readonly body: unknown;
  readonly issues: { path: (string | number)[]; message: string }[];
}

export declare function describeRunwayFailure(err: unknown): { message: string };
export declare function parseRunwayApiErrorReason(body: unknown): string | undefined;
export declare function listTaskTypes(filter: {
  modality?: string;
  kind?: string;
}): { type: string; label: string; provider: string; description: string }[];
export declare function snapAspectRatio(
  width: number,
  height: number,
  alias: string
): string | undefined;

/** Test hooks (mock only). */
export declare function __mockFailNext(): void;
export declare function __mockResetTasks(): void;
export declare function lookFromPrompt(prompt: unknown): string;
export declare function lifestylePlanAnswer(count: number): { frames: Record<string, unknown>[] };
