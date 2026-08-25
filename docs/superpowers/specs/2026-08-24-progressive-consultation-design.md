# Progressive Consultation Delivery Design

## Goal

Make the lawyer see a concise core legal judgment before the full consultation analysis is ready, without removing the existing task planning, legal-tool retrieval, final response validation, or persistence flow.

## Delivery contract

The client sends the authenticated POST request to a new consultation streaming endpoint and receives SSE frames over that same request.

1. `core_delta` frames contain an immediately streamed two-sentence judgment generated from only the current question.
2. The task planner and explicitly requested legal tools run concurrently with the core stream.
3. `answer_delta` frames append the complete answer generated from the existing compressed task package and tool results.
4. `complete` includes the persisted entry ID, references, and total elapsed time.
5. `error` provides only the existing user-safe business error message.

The core reply is a provisional first-screen aid. It receives programmatic response validation before it can be sent. The final reply remains the only answer persisted to the consultation record and remains subject to response validation.

## Server design

Add a reusable OpenAI-compatible streaming model helper which measures request preparation, time-to-first-token, generation, total time, token usage, model, and finish reason. The existing non-streaming helper remains for task planning.

The streaming route creates the normal consultation entry, starts the low-context core call and the existing planning/tool work in parallel, then streams the complete responder call when the task package is available. The route writes the same performance summary as today plus `core` timing data.

The core prompt is a separately versioned `lawyer_core` configuration. It requires a guarded, concise conclusion and key condition, cannot cite unverified sources, and must state material uncertainty. The response prompt remains `lawyer_response`.

## Client design

Replace the one-shot consultation fetch with a POST stream reader. Insert a pending assistant message when the request begins, append core chunks as they arrive, append a separated full-analysis continuation when final chunks arrive, and attach law/case cards only on `complete`. The elapsed timer remains continuous across both phases.

## Constraints

- One additional model call per consultation is explicitly authorized for the core judgment.
- No additional legal-tool call is added.
- Existing non-streaming route remains available during rollout for rollback.
- Do not expose internal prompts, task plans, tools, errors, or raw SSE provider payloads.
- No changes to login, timeline, card ordering, or prompt keys `lawyer_agent` and `lawyer_response`.
