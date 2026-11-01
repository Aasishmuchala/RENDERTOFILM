# The chat runs its own streaming tool loop on the Anthropic SDK

Status: accepted (2026-10-31)

## Context

The chat has to stream an answer, call tools, hold a conversation across many turns, resume after the app was quit mid-turn, and prove to a test that it never repeats a paid call. The app has no multi-turn or tool path today: every planner is one prompt in and one answer out, through `createTextTask`, and the Runway text path cannot take a message list, tools or thinking blocks. Chat needs a direct Anthropic key, which the Owner saves in Settings.

## Decision

We write the loop ourselves on `@anthropic-ai/sdk`, using its streaming messages call. It keeps every API message verbatim (thinking blocks and their signatures included, in order) and saves the assistant message before it runs any tool. A turn is a small state machine, capped at 12 model calls, and each move is saved. Read tools run together, every other class one at a time in the model's order. The loop takes the model, the tools, the store and the gate as injected types and imports no concrete adapter, so a scripted fake model drives every test and the real SDK is one adapter.

## Alternatives

- **Claude Agent SDK.** It brings its own sessions, file and shell tools and its own permission model; none fits a desktop app whose only tools are our own, and its journal is not ours to resume from.
- **The SDK's tool runner.** It hides the iteration, so the verbatim journal, the save-before-tool rule, the per-class ordering and the stop on a proposed spend would all have to be fought for.
- **`createTextTask` as it is.** One string in, text out. It drops thinking blocks, cannot carry tool results, and is pinned by the Claude call-site guard, which a chat caller should not disturb.
- **Runway's hosted text task.** No history, no tools, no cancel.

## Consequences

- We own the stop reasons: end of turn, tool use, max tokens, refusal, pause, context window. Each has a test.
- Replaying messages byte for byte is a contract with the API; the fake server checks it.
- Chat only works with a direct Anthropic key. Runway and OmegaPlus as the planner provider show a setup card; OmegaPlus waits for a paid probe the Owner has to approve.
- The Claude call-site guard does not see the chat loop. The loop has its own tests instead.
