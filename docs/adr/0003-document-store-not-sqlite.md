# Threads, Runs and Quotes live in the document store, not in SQLite

Status: accepted for v1 (2026-10-31); `runs.db` is deferred, not rejected

## Context

The chat needs durable threads, runs, quotes, an event feed and an audit trail, for the desktop app and for Bay. Bay has no `db` feature in this app and no database stand-in exists on the desktop side. The desktop import already moves everything under `storage/`, renaming the owner key in file names and in the JSON text, so a new prefix that carries the owner key imports for free. The document store is whole-document: every update rewrites, syncs and copies the file.

## Decision

Everything goes through the existing document store under new prefixes: `chat/` for the thread index, threads, runs, quotes, the allowance ledger and the audit trail, and `chat-events/` for events. One persistence path serves Bay and the desktop. To keep an append from costing the whole document, events are written in segments of 100 and the audit trail in one file per day, and a run is its own document. The messages of a thread are capped at the newest 400 on Bay and kept whole on the desktop. Keys stay under the 140-character limit the desktop enforces.

## Alternatives

- **SQLite (`runs.db`) in the desktop app.** Appends are cheap and queries are natural, but Bay would need a second implementation or a hosted database it does not have, and the import, backup and restore paths for `storage/` would have to learn a second kind of file. Deferred: revisit when event volume or query needs make the segmented documents hurt (a thread with many thousands of events, or run history search).
- **A Postgres feature on Bay and SQLite on the desktop.** Two stores behind one interface doubles the places a bug can hide and the tests to write.
- **One growing document per thread.** Simple, but each event rewrites the whole thread on the desktop.

## Consequences

- No query language: lists come from index documents and filters run in memory over small sets (50 threads, a handful of active runs).
- A segment is immutable once full, so reading events since a number touches only the segments after it.
- Concurrent writers rely on the store's per-key update; the update function must be pure because Bay retries it.
- Moving to SQLite later is a change behind the `Store` interface and an import step, not a change to the loop, the gate or the engine.
