# Spending is released by a gate in code, never by the model

Status: accepted (2026-10-31)

## Context

The agent plans a film and the film costs money: stills, clips and the master are paid provider work. A model can be talked into things by the text of a render's file name, a tool result or a user message that quotes someone else. The research behind the chat found one rule worth building around: nothing the model writes can approve spending.

## Decision

The model has a `propose_run` tool and no tool that starts a Run. Proposing creates a free Quote bound to a hash of the exact spec. The gate releases a Quote in exactly four ways: the Owner clicks the card (`chat.decide`), the Owner types a bare yes that a fixed grammar in code matches and that is newer than the latest open Quote, an Allowance the Owner set covers it, or the amount is zero (local work). A Quote expires in 30 minutes, can be used once, and is superseded when the spec changes. A Quote with an unknown amount is never paid from an Allowance, so it waits for a click or a typed yes. The release writes an audit row, reserves the Allowance, and only then does the RunEngine start.

## Alternatives

- **`start_run(quote_id)` as a tool, as the research proposed.** It leaves a model-initiated path to spend, so the rule that tool output never approves needs an exception. Removing the tool removes the exception.
- **Ask the model to confirm in prose.** The confirmation would be the thing being attacked.
- **A flat budget cap only.** A cap stops a runaway but not a wrong film; the click shows the Owner what they are paying for.

## Consequences

- Every spend has a Quote, a source (click, text, allowance, free) and an audit row, so the day's spending can be exported.
- Bay cannot price a spec (the provider reports no rates there), so its Quotes show no amount, always need a click, and the Allowance is off.
- The stop on a proposed spend lives in the turn loop: a Quote that is open with an amount above zero ends the Turn awaiting the Owner.
- The gate is a small module with an interface of seven calls, tested with a fake pricer and an in-memory store.
