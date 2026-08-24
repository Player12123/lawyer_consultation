import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("production API keeps the public boundary and readiness contract", async () => {
  const api = await readFile(new URL("backend/server.mjs", root), "utf8");

  assert.match(api, /APP_ENV/);
  assert.match(api, /APP_ORIGIN/);
  assert.match(api, /COOKIE_SECURE/);
  assert.doesNotMatch(api, /body\.phone === config\.bootstrapAdminPhone \? "system_admin" : "agent"/);
  assert.doesNotMatch(api, /BOOTSTRAP_ADMIN_PHONE/);
  assert.match(api, /display_name: `用户\$\{body\.phone\.slice\(-4\)\}`/);
  assert.match(api, /request\.url === "\/readyz"|"\/readyz".*includes/);
  assert.match(api, /server\.listen\(config\.port, "127\.0\.0\.1"/);
  assert.match(api, /生产环境必须使用 HTTPS、Secure Cookie 并配置 CONSULTATION_CONTENT_KEY/);
});

test("temporary acceptance can opt into insecure SMS gateway endpoints explicitly", async () => {
  const api = await readFile(new URL("backend/server.mjs", root), "utf8");
  assert.match(api, /SMS_ALLOW_INSECURE_ENDPOINT/);
  assert.match(api, /!allowInsecureEndpoint/);
});

test("auth bootstrap falls back to login when session restore fails", async () => {
  const page = await readFile(new URL("app/page.tsx", root), "utf8");

  assert.match(page, /api<\{ user: Account \}>\("\s*\/api\/v1\/auth\/me"\s*, \{ method: "POST" \}\)\.then\(\(\{ user \}\) =>/);
  assert.match(page, /catch\(\(\) => \{[^}]*setAccount\(null\);[^}]*setPage\("login"\);[^}]*setAuthChecking\(false\);/s);
});

test("login sessions use a ten-minute idle window and replace prior account sessions", async () => {
  const [api, page] = await Promise.all([
    readFile(new URL("backend/server.mjs", root), "utf8"),
    readFile(new URL("app/page.tsx", root), "utf8"),
  ]);

  assert.match(api, /sessionMinutes:\s*10/);
  assert.doesNotMatch(api, /sessionHours:\s*8/);
  assert.match(api, /new Date\(Date\.now\(\) \+ config\.sessionMinutes \* 60_000\)/);
  assert.match(api, /UPDATE sessions SET revoked_at = NOW\(\) WHERE tenant_id = \? AND user_id = \? AND revoked_at IS NULL/);
  assert.match(api, /async function refreshSession\(request, response, session\)/);
  assert.match(api, /UPDATE sessions SET last_seen_at = NOW\(\), expires_at = DATE_ADD\(NOW\(\), INTERVAL 10 MINUTE\) WHERE id = \?/);
  assert.match(page, /window\.setInterval\(\(\) => void refreshSession\(\), 60_000\)/);
});

test("server permits an open page to keep a session alive but expires inactive sessions", async () => {
  const api = await readFile(new URL("backend/server.mjs", root), "utf8");

  assert.match(api, /s\.expires_at > NOW\(\)/);
  assert.doesNotMatch(api, /s\.created_at > DATE_SUB\(NOW\(\), INTERVAL 10 MINUTE\)/);
});

test("unauthenticated development consultation bypasses are absent", async () => {
  const [api, page] = await Promise.all([
    readFile(new URL("backend/server.mjs", root), "utf8"),
    readFile(new URL("app/page.tsx", root), "utf8"),
  ]);

  assert.doesNotMatch(api, /dev-consultation-session|LOCAL_TEST_LOGIN_CODE|LOCAL_TEST_LOGIN_PHONES|isLocalTestLogin|\/api\/v1\/consultations\/test/);
  assert.doesNotMatch(page, /test-consultation|dev-consultation-session/);
  await assert.rejects(access(new URL("app/lab/page.tsx", root)));
});

test("consultations persist precise V2 and tool stage timings", async () => {
  const [api, schema] = await Promise.all([
    readFile(new URL("backend/server.mjs", root), "utf8"),
    readFile(new URL("db/schema/consultations.ts", root), "utf8"),
  ]);

  assert.match(schema, /stageTimings: json\("stage_timings"\)/);
  assert.match(api, /planner_ms/);
  assert.match(api, /\$\{name\}_search_ms/);
  assert.match(api, /responder_ms/);
  assert.match(api, /validator_ms/);
  assert.match(api, /UPDATE consultation_entries SET answer_ciphertext = \?, route = \?, matched_laws = \?, matched_cases = \?, stage_timings = \?/);
});

test("consultations retain non-streaming model and tool performance diagnostics", async () => {
  const api = await readFile(new URL("backend/server.mjs", root), "utf8");

  for (const field of ["request_prepare_ms", "ttft_ms", "ttft_unavailable", "generation_ms", "model_total_ms", "input_tokens", "output_tokens", "total_tokens", "finish_reason", "message_count", "prompt_chars", "context_chars"]) assert.match(api, new RegExp(field));
  assert.match(api, /stream: false/);
  assert.match(api, /timeout \? "timeout" : "error"/);
  assert.match(api, /result_count: 0/);
  assert.match(api, /\[PERF\]/);
});

test("progressive consultation endpoint delivers validated core and complete segments", async () => {
  const [api, prompts] = await Promise.all([readFile(new URL("backend/server.mjs", root), "utf8"), readFile(new URL("backend/legal-agent-v2.mjs", root), "utf8")]);

  assert.match(prompts, /LAWYER_CORE_PROMPT_KEY\s*=\s*"lawyer_core"/);
  assert.match(api, /request\.url === "\/api\/v1\/consultations\/stream"/);
  assert.match(api, /text\/event-stream/);
  assert.match(api, /core_delta/);
  assert.match(api, /answer_delta/);
  assert.match(api, /validatedDelivery\(\{ response: result\.content/);
  assert.match(api, /validatedDelivery\(\{ response: full\.agent\.suggested_reply/);
});


test("case tool strong trigger recognizes explicit similar-case wording", async () => {
  const api = await readFile(new URL("backend/server.mjs", root), "utf8");

  assert.match(api, /类似案件/);
  assert.match(api, /相似案件/);
  assert.match(api, /法律规定/);
  assert.match(api, /法律条款/);
});

test("consultation avoids duplicate retrieval and unused raw-history preparation", async () => {
  const [api, page] = await Promise.all([
    readFile(new URL("backend/server.mjs", root), "utf8"),
    readFile(new URL("app/page.tsx", root), "utf8"),
  ]);

  assert.doesNotMatch(page, /fetchReferences/);
  assert.doesNotMatch(api, /async function retrieveEntryReferences/);
  assert.doesNotMatch(api, /SELECT question_ciphertext, answer_ciphertext, business_type FROM consultation_entries/);
  assert.doesNotMatch(api, /function normalizeHistory/);
  assert.match(api, /const caseKeywordText = sanitizedMessage\.slice\(0, 1000\)/);
});

test("runtime prompt registry only recognizes active planner and responder keys", async () => {
  const api = await readFile(new URL("backend/server.mjs", root), "utf8");

  assert.match(api, /\[LAWYER_AGENT_PROMPT_KEY\]/);
  assert.match(api, /\[LAWYER_RESPONSE_PROMPT_KEY\]/);
  assert.doesNotMatch(api, /legal_consultation/);
  assert.doesNotMatch(api, /LAWYER_GATEKEEPER_PROMPT/);
});

test("documentation does not preserve bootstrap-admin-by-phone instructions", async () => {
  const [handover, permissions, resourceRequest] = await Promise.all([
    readFile(new URL("docs/production-handover.md", root), "utf8"),
    readFile(new URL("docs/permissions.md", root), "utf8"),
    readFile(new URL("docs/company-resource-request.md", root), "utf8"),
  ]);

  for (const document of [handover, permissions, resourceRequest]) assert.doesNotMatch(document, /BOOTSTRAP_ADMIN_PHONE|首次指定系统管理员登录/);
  assert.match(permissions, /短信登录.*普通用户 `agent`/);
  assert.match(resourceRequest, /短信自助登录账号不得作为系统管理员来源/);
});

test("temporary acceptance exposes only local web port through Quick Tunnel", async () => {
  const [handover, apiDeployment] = await Promise.all([
    readFile(new URL("docs/production-handover.md", root), "utf8"),
    readFile(new URL("docs/production-api-deployment.md", root), "utf8"),
  ]);

  assert.match(handover, /cloudflared tunnel --url http:\/\/127\.0\.0\.1:3000/);
  assert.match(handover, /不得.*8788/);
  assert.match(handover, /MySQL.*不得.*公网/);
  assert.match(apiDeployment, /Quick Tunnel.*3000/);
  assert.match(apiDeployment, /API 8788.*不得通过 Quick Tunnel/);
});

test("retention and migration safety are part of the release artifact", async () => {
  const [api, migration] = await Promise.all([
    readFile(new URL("backend/server.mjs", root), "utf8"),
    readFile(new URL("db/migrations/0005_reflective_harpoon.sql", root), "utf8"),
  ]);

  assert.match(api, /DELETE FROM verification_codes/);
  assert.match(api, /DELETE FROM sessions/);
  assert.match(api, /content_purged_at = NOW\(\)/);
  assert.doesNotMatch(migration, /active_consultation_contexts_context_id_consultation_contexts_id_fk/);
  assert.match(migration, /CONSTRAINT `acc_context_id_fk`/);
  await access(new URL("deploy/nginx/pocket-legal-assistant.conf", root));
  await access(new URL("deploy/systemd/pocket-legal-api.service", root));
  await access(new URL("docs/production-handover.md", root));
});

test("operations artifacts make rollback, secret-safe logging, and dependency audits enforceable", async () => {
  const [api, packageJson, handover, rollbackRunbook] = await Promise.all([
    readFile(new URL("backend/server.mjs", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
    readFile(new URL("docs/production-handover.md", root), "utf8"),
    readFile(new URL("docs/rollback-runbook.md", root), "utf8"),
  ]);

  assert.doesNotMatch(api, /console\.error\(exception\)/);
  assert.match(api, /console\.error\("API request failed", safeErrorMessage\(exception\)\)/);
  assert.match(packageJson, /"test"\s*:\s*"npm run build && npm run security:log-safety && node --test tests\/\*\.test\.mjs"/);
  assert.match(packageJson, /"security:audit"\s*:\s*"npm audit --omit=dev --audit-level=high"/);
  assert.match(handover, /rollback-runbook\.md/);
  assert.match(rollbackRunbook, /禁止.*一键.*数据库/);
  assert.match(rollbackRunbook, /rollback\.sh/);
  await access(new URL("deploy/scripts/rollback.sh", root));
  await access(new URL("docs/security-audit-record.md", root));
});
