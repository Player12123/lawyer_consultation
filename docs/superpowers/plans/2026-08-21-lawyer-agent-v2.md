# Lawyer Agent V2 Implementation Plan

**Goal:** Evolve the consultation orchestration into an internal legal-task agent followed by a separate lawyer-facing response stage, without changing the browser API.

**Architecture:** Keep the existing encrypted context and legal search clients. Add versioned prompt keys for the V2 task agent and reserved response/gatekeeper prompts; the active legacy consultation prompt remains the compatibility response renderer until a formal V2-B prompt is supplied. The V2 agent emits a validated internal task plan, tool routing executes from that plan, and only the renderer's final text reaches the UI.

**Tech Stack:** Node.js HTTP server, MySQL prompt version store, OpenAI-compatible chat completions, existing law/case HTTP tools.

## Tasks

1. Add prompt registry and safe bootstrapping for `lawyer_agent_v2`; reserve `lawyer_response_v2` and `lawyer_gatekeeper_v2` as explicit placeholders.
2. Introduce internal task-plan parsing, fallback planning, and a tool registry boundary that reuses existing law/case clients.
3. Split `runLegalAgent` into plan → tools → response rendering; keep internal outputs off the public HTTP payload while persisting the updated case state.
4. Restore tool retrieval for the real consultation endpoint, and update prompt audit metadata to record both agent and renderer versions.
5. Add behavioral regression coverage and run the complete build/test suite.
