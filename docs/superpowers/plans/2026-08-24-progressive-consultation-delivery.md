# Progressive Consultation Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stream a safe core legal judgment before the complete consultation analysis.

**Architecture:** A POST SSE endpoint starts a small core model call in parallel with the existing planning and retrieval chain. It later streams the full responder answer, validates both lawyer-visible portions locally, persists only the final answer, and returns reference cards in a completion event.

**Tech Stack:** Node HTTP server, OpenAI-compatible streaming SSE, React 19, TypeScript, node:test.

**Spec:** `docs/superpowers/specs/2026-08-24-progressive-consultation-design.md`

## Global Constraints

- Add one core model call only; do not add legal-tool calls.
- Keep `lawyer_agent` and `lawyer_response` keys unchanged.
- Core and final output must pass the programmatic validator before browser delivery.
- Retain the current POST JSON endpoint for rollback.

---

### Task 1: Model stream and core prompt

**Files:**
- Modify: `backend/server.mjs`
- Modify: `backend/legal-agent-v2.mjs`
- Test: `tests/production-contract.test.mjs`

**Interfaces:**
- Produces `callModelStream(messages, options)` yielding `{ type: "delta" | "complete", ... }`.
- Produces `LAWYER_CORE_PROMPT_KEY = "lawyer_core"`.

- [ ] Write a failing source-contract test requiring a streaming helper, `text/event-stream`, and a `lawyer_core` prompt key.
- [ ] Run `node --test tests/production-contract.test.mjs` and confirm failure.
- [ ] Implement SSE parsing, timing capture, and the constrained core prompt.
- [ ] Run the focused test and confirm pass.

### Task 2: Progressive consultation endpoint

**Files:**
- Modify: `backend/server.mjs`
- Test: `tests/production-contract.test.mjs`

**Interfaces:**
- Consumes authenticated POST JSON `{ message, clientRequestId }`.
- Produces SSE events `core_delta`, `answer_delta`, `complete`, and `error`.

- [ ] Write a failing source-contract test for the streaming endpoint and required event names.
- [ ] Run the focused test and confirm failure.
- [ ] Implement the endpoint with parallel core/planner/tool work, validation, persistence, and safe error handling.
- [ ] Run the focused test and confirm pass.

### Task 3: Browser stream reader

**Files:**
- Modify: `app/page.tsx`
- Test: `tests/elapsed-duration.test.mjs`

**Interfaces:**
- Consumes the four server event types.
- Updates the pending assistant message progressively and attaches references on `complete`.

- [ ] Write a failing source-contract test requiring a stream reader and progressive event handling.
- [ ] Run the focused test and confirm failure.
- [ ] Implement POST stream parsing and progressive assistant updates while retaining the continuous timer.
- [ ] Run the focused test and confirm pass.

### Task 4: Verification

**Files:**
- Test: `tests/*.test.mjs`

- [ ] Run `npm test` and inspect all results.
- [ ] Run an authenticated local consultation and record core first-token timing, complete reply timing, tool timings, and final cards.
