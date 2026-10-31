// The Provider contract: one shape for everyone who can run a generation task.
// ../bay/tasks.js owns tasks.json and calls in here; a provider owns `task.real`
// and writes it through `env.persist()`. Nothing to import at run time, only the
// JSDoc types.
//
// Money rules, for every provider that bills: a task reaches the paid call at
// most once. Its state is `submitted` on disk before the call, the remote id is
// on disk the moment the reply is, and resume() only ever follows that id.

/**
 * What the Settings page and the model selects read; see src/capabilities.ts.
 * @typedef {{
 *   provider: 'higgsfield'|'runway'|'simulator', providerName: string, desktop: boolean,
 *   imageModels: string[], videoModels: string[], stillUpscalers: string[], clipUpscalers: string[],
 *   aleph: boolean, export: boolean, recreate: boolean, textViaRunway: boolean,
 *   notes: Record<string, string>, rates: Record<string, string>,
 * }} Capabilities
 */

/**
 * What every provider call gets. `owner` picks the account, `persist` saves
 * tasks.json (synchronously, so a state is on disk when the call returns).
 * @typedef {{ owner: string, persist: () => void, getState: () => object, mockOrigin: () => string }} ProviderEnv
 */

/**
 * @typedef {{
 *   kind: string,
 *   state?: 'queued'|'running'|'uploading'|'quoting'|'submitted'|'waiting'|'downloading'|'succeeded'|'failed',
 *   notes?: string[], credits?: number, jobId?: string, remoteId?: string, resultUrl?: string,
 *   width?: number, height?: number, duration?: number, frameRate?: number, error?: string, hint?: string,
 * }} TaskReal
 */

/**
 * @typedef {{
 *   id: string, name: string,
 *   capabilities(): Capabilities,
 *   supports(type: string, options: object): { ok: true, notes: string[] } | { ok: false, reason: string },
 *   start(task: object, options: object, env: ProviderEnv): Promise<void>,
 *   snapshot(task: object, opts?: { includeText?: boolean }): object,
 *   artifactMeta(task: object): { metadata?: object },
 *   resume(task: object, env: ProviderEnv): Promise<void> | void,
 *   account(owner: string): Promise<{ label: string, email?: string, credits?: number, plan?: string, signedIn: boolean } | null>,
 *   rates?: Record<string, string>,
 * }} Provider
 *
 * `supports` refuses in one sentence, which the visitor reads. `start` runs the
 * whole pipeline and never rejects. `resume` is called once, at boot, for a task
 * in `submitted`, `waiting` or `downloading`. `account` makes free calls only.
 */

export {};
