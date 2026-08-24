/**
 * Production API entry point. Run this service behind the same-origin reverse
 * proxy at /api; browsers must never reach the database, SMS or model service.
 */
import dotenv from "dotenv";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import mysql from "mysql2/promise";
import { LAWYER_AGENT_PROMPT_KEY, LAWYER_AGENT_PROMPT, LAWYER_RESPONSE_PROMPT_KEY, LAWYER_RESPONSE_PROMPT, LAWYER_CORE_PROMPT_KEY, LAWYER_CORE_PROMPT, compactCaseFacts, compactTaskPlan, compactToolResults, createFallbackTaskPlan, parseTaskPlan, publicConsultationResult, selectToolsForTaskPlan } from "./legal-agent-v2.mjs";
import { validatedDelivery } from "./response-validator.mjs";

// Local convenience only. In production, the process environment comes from
// the cloud secret manager and has precedence over this ignored file.
dotenv.config({ path: process.env.ENV_FILE ?? ".env.local" });

const required = ["DATABASE_URL", "TENANT_ID", "SESSION_TOKEN_PEPPER", "PHONE_HASH_PEPPER", "VERIFICATION_CODE_PEPPER"];
for (const key of required) if (!process.env[key] || process.env[key]?.startsWith("REPLACE_")) throw new Error(`Missing required environment variable: ${key}`);

const appEnvironment = process.env.APP_ENV ?? "development";
if (!["development", "production"].includes(appEnvironment)) throw new Error("APP_ENV must be development or production");
const configuredOrigin = process.env.APP_ORIGIN ?? "http://localhost:3000";
function envNumber(key, fallback, { integer = true, min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = process.env[key];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw new Error(`${key} must be a ${integer ? "whole " : ""}number between ${min} and ${max}`);
  return value;
}
const config = {
  port: envNumber("API_PORT", 8788, { min: 1, max: 65_535 }),
  origin: configuredOrigin.replace(/\/$/, ""),
  tenantId: process.env.TENANT_ID,
  cookieName: "pla_session",
  sessionMinutes: envNumber("SESSION_IDLE_MINUTES", 10, { min: 1, max: 1_440 }),
  phoneChangeProofMinutes: envNumber("PHONE_CHANGE_PROOF_MINUTES", 10, { min: 1, max: 1_440 }),
  sessionPepper: process.env.SESSION_TOKEN_PEPPER,
  phonePepper: process.env.PHONE_HASH_PEPPER,
  codePepper: process.env.VERIFICATION_CODE_PEPPER,
  smsProvider: process.env.SMS_PROVIDER ?? "bestone",
  aiThinkingType: process.env.AI_THINKING_TYPE ?? "disabled",
  aiTemperature: envNumber("AI_TEMPERATURE", 0.35, { integer: false, min: 0, max: 2 }),
  aiTimeout: envNumber("AI_TIMEOUT_MS", 45_000, { min: 1_000, max: 300_000 }),
  legalToolsAppId: process.env.LEGAL_TOOLS_X_APP_ID ?? "",
  legalToolsAppSecret: process.env.LEGAL_TOOLS_X_APP_SECRET ?? "",
  lawSearchTimeout: envNumber("LAW_SEARCH_TIMEOUT_MS", 4_000, { min: 500, max: 120_000 }),
  caseSearchTimeout: envNumber("CASE_SEARCH_TIMEOUT_MS", 5_000, { min: 500, max: 120_000 }),
  consultationContentDays: envNumber("CONSULTATION_CONTENT_RETENTION_DAYS", 365, { min: 1, max: 3_650 }),
  internalErrorLogDays: envNumber("INTERNAL_ERROR_LOG_RETENTION_DAYS", 200, { min: 1, max: 3_650 }),
};
const databaseHost = new URL(process.env.DATABASE_URL).hostname;
const localDatabase = databaseHost === "localhost" || databaseHost === "127.0.0.1";
const db = mysql.createPool({ uri: process.env.DATABASE_URL, connectionLimit: 10, enableKeepAlive: true, ...(!localDatabase ? { ssl: { rejectUnauthorized: true } } : {}) });
const recordedErrors = new WeakSet();
class PublicError extends Error { constructor(status, message) { super(message); this.status = status; } }
// Public deployments must use Secure cookies. Disable only for local HTTP.
const cookieSecure = process.env.COOKIE_SECURE === "true" || (process.env.COOKIE_SECURE !== "false" && !config.origin.startsWith("http://localhost") && !config.origin.startsWith("http://127.0.0.1"));
const configured = (value) => typeof value === "string" && value.length > 0 && !value.startsWith("REPLACE_");
const aiEnabled = configured(process.env.AI_BASE_URL) && configured(process.env.AI_API_KEY) && configured(process.env.AI_MODEL);
const lawSearchEnabled = configured(process.env.LAW_SEARCH_ENDPOINT) && configured(config.legalToolsAppId) && configured(config.legalToolsAppSecret);
const caseSearchEnabled = configured(process.env.CASE_SEARCH_ENDPOINT) && configured(config.legalToolsAppId) && configured(config.legalToolsAppSecret);
const now = () => new Date();
const id = () => randomBytes(16).toString("hex").slice(0, 26);
const hash = (value, pepper) => createHash("sha256").update(`${pepper}:${value}`).digest("hex");
// MySQL GET_LOCK names may not exceed 64 characters. Never put raw phone or
// tenant values in lock names; a short deterministic digest keeps locks safe.
const lockName = (kind, value) => `${kind}:${hash(value, config.sessionPepper).slice(0, 63 - kind.length)}`;
const phoneHash = (phone) => hash(phone, config.phonePepper);
const codeHash = (phone, code) => hash(`${phone}:${code}`, config.codePepper);
// Domain separation prevents consultation encryption from reusing the session
// hashing construction directly. The stored envelope includes a fresh IV and
// authentication tag for every question and answer.
const legacyContentEncryptionKey = createHash("sha256").update(`pocket-legal:consultation:v1:${config.sessionPepper}`).digest();
const dedicatedContentEncryptionKey = process.env.CONSULTATION_CONTENT_KEY && !process.env.CONSULTATION_CONTENT_KEY.startsWith("REPLACE_")
  ? createHash("sha256").update(`pocket-legal:consultation:v2:${process.env.CONSULTATION_CONTENT_KEY}`).digest()
  : null;
if (appEnvironment === "production" && (!config.origin.startsWith("https://") || !cookieSecure || !dedicatedContentEncryptionKey)) throw new Error("生产环境必须使用 HTTPS、Secure Cookie 并配置 CONSULTATION_CONTENT_KEY");
function encryptContent(plaintext) {
  const iv = randomBytes(12);
  const version = dedicatedContentEncryptionKey ? "v2" : "v1";
  const cipher = createCipheriv("aes-256-gcm", dedicatedContentEncryptionKey ?? legacyContentEncryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  return `${version}.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
}
function decryptContent(envelope) {
  if (!envelope) return "";
  const [version, ivValue, tagValue, ciphertextValue] = String(envelope).split(".");
  if (!["v1", "v2"].includes(version) || !ivValue || !tagValue || ciphertextValue === undefined) throw new Error("咨询记录密文格式无效");
  const key = version === "v2" ? dedicatedContentEncryptionKey : legacyContentEncryptionKey;
  if (!key) throw new Error("缺少咨询记录专用解密密钥");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextValue, "base64url")), decipher.final()]).toString("utf8");
}
function phoneChangeProof(session) {
  const expiresAt = Date.now() + config.phoneChangeProofMinutes * 60_000;
  const payload = `${session.id}:${session.user_id}:${phoneHash(session.phone)}:${expiresAt}`;
  const signature = createHmac("sha256", config.sessionPepper).update(payload).digest("base64url");
  return `${Buffer.from(payload).toString("base64url")}.${signature}`;
}
function validPhoneChangeProof(proof, session) {
  const [encoded, signature] = String(proof ?? "").split(".");
  if (!encoded || !signature) return false;
  const payload = Buffer.from(encoded, "base64url").toString("utf8");
  const expected = createHmac("sha256", config.sessionPepper).update(payload).digest("base64url");
  const signatureMatches = Buffer.byteLength(signature) === Buffer.byteLength(expected) && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  const [sessionId, userId, currentPhoneHash, expiresAt] = payload.split(":");
  return signatureMatches && sessionId === session.id && userId === session.user_id && currentPhoneHash === phoneHash(session.phone) && Number(expiresAt) > Date.now();
}
const ipHash = (request) => hash((request.headers["x-forwarded-for"]?.split(",")[0] ?? request.socket.remoteAddress ?? "unknown").trim(), config.phonePepper);
const json = (response, status, body) => response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "x-frame-options": "DENY" }).end(JSON.stringify(body));
const error = (response, status, message) => json(response, status, { message });
const beginSse = (response) => response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
const sendSse = (response, event, payload) => response.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);

function parseCookies(request) {
  return Object.fromEntries((request.headers.cookie ?? "").split(";").map((value) => value.trim().split(/=(.*)/s)).filter(([key]) => key).map(([key, value]) => [key, decodeURIComponent(value ?? "")]));
}
async function bodyOf(request) {
  let body = "";
  for await (const chunk of request) { body += chunk; if (body.length > 16_384) throw new Error("请求过大"); }
  try { return JSON.parse(body || "{}"); } catch { throw new Error("请求格式无效"); }
}
function validPhone(phone) { return typeof phone === "string" && /^1[3-9]\d{9}$/.test(phone); }
function redactSensitive(text) { return text.replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, "[手机号已脱敏]").replace(/(?<![0-9Xx])[1-9]\d{5}(?:18|19|20)?\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[0-9Xx](?![0-9Xx])/g, "[身份证号已脱敏]"); }
async function audit(tenantId, eventType, request, metadata = {}, actorUserId = null) {
  await db.execute("INSERT INTO audit_events (tenant_id, actor_user_id, event_type, request_id, ip_hash, metadata, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [tenantId, actorUserId, eventType, id(), ipHash(request), JSON.stringify(metadata), now()]);
}
async function withDatabaseLock(name, task) {
  const connection = await db.getConnection();
  try {
    const [locks] = await connection.execute("SELECT GET_LOCK(?, 2) AS acquired", [name]);
    if (Number(locks[0]?.acquired) !== 1) throw new PublicError(429, "请求过于频繁，请稍后再试");
    return await task(connection);
  } finally {
    await connection.execute("SELECT RELEASE_LOCK(?)", [name]).catch(() => undefined);
    connection.release();
  }
}
async function sessionFor(request) {
  const token = parseCookies(request)[config.cookieName];
  if (!token || token.length < 32) return null;
  const [rows] = await db.execute("SELECT s.id, s.user_id, s.tenant_id, u.display_name, u.phone, u.role, u.group_id FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > NOW() AND u.status = 'active' LIMIT 1", [hash(token, config.sessionPepper)]);
  return rows[0] ?? null;
}
function canManageTeam(session) { return session?.role === "system_admin" || session?.role === "group_admin"; }
function setSessionCookie(response, token, expiresAt) {
  response.setHeader("set-cookie", `${config.cookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly;${cookieSecure ? " Secure;" : ""} SameSite=Strict; Expires=${expiresAt.toUTCString()}`);
}
async function refreshSession(request, response, session) {
  const token = parseCookies(request)[config.cookieName];
  if (!token || !session) return;
  const expiresAt = new Date(Date.now() + config.sessionMinutes * 60_000);
  await db.execute("UPDATE sessions SET last_seen_at = NOW(), expires_at = DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE id = ?", [config.sessionMinutes, session.id]);
  setSessionCookie(response, token, expiresAt);
}
async function sendTencentSms(phone, code) {
  const secretId = process.env.SMS_TENCENT_SECRET_ID;
  const secretKey = process.env.SMS_TENCENT_SECRET_KEY;
  const sdkAppId = process.env.SMS_TENCENT_SDK_APP_ID;
  const signName = process.env.SMS_TENCENT_SIGN_NAME;
  const templateId = process.env.SMS_TENCENT_TEMPLATE_ID;
  if (![secretId, secretKey, sdkAppId, signName, templateId].every((value) => value && !value.startsWith("REPLACE_"))) throw new Error("短信服务未完成配置");
  const host = "sms.tencentcloudapi.com";
  const payload = JSON.stringify({ PhoneNumberSet: [`+86${phone}`], SmsSdkAppId: sdkAppId, SignName: signName, TemplateId: templateId, TemplateParamSet: [code, "5"] });
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const payloadHash = createHash("sha256").update(payload).digest("hex");
  const canonicalRequest = `POST\n/\n\ncontent-type:application/json; charset=utf-8\nhost:${host}\n\ncontent-type;host\n${payloadHash}`;
  const credentialScope = `${date}/sms/tc3_request`;
  const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${credentialScope}\n${createHash("sha256").update(canonicalRequest).digest("hex")}`;
  const sign = (key, value) => createHmac("sha256", key).update(value).digest();
  const signature = createHmac("sha256", sign(sign(sign(`TC3${secretKey}`, date), "sms"), "tc3_request")).update(stringToSign).digest("hex");
  const authorization = `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=content-type;host, Signature=${signature}`;
  const response = await fetch(`https://${host}`, { method: "POST", headers: { Authorization: authorization, "Content-Type": "application/json; charset=utf-8", Host: host, "X-TC-Action": "SendSms", "X-TC-Version": "2021-01-11", "X-TC-Region": process.env.SMS_TENCENT_REGION ?? "ap-guangzhou", "X-TC-Timestamp": String(timestamp) }, body: payload });
  const result = await response.json();
  if (!response.ok || result.Response?.Error || result.Response?.SendStatusSet?.some((item) => item.Code !== "Ok")) throw new Error("短信服务暂时不可用");
}
async function sendBestoneSms(phone, code) {
  const endpoint = process.env.SMS_BESTONE_ENDPOINT;
  const appId = process.env.SMS_BESTONE_APP_ID;
  const password = process.env.SMS_BESTONE_PASSWORD;
  const allowInsecureEndpoint = process.env.SMS_ALLOW_INSECURE_ENDPOINT === "true";
  if (![endpoint, appId, password].every((value) => value && !value.startsWith("REPLACE_"))) throw new Error("短信服务未完成配置");
  if (!endpoint.startsWith("https://") && !allowInsecureEndpoint) throw new Error("短信网关必须使用 HTTPS 地址；请向供应商索取 HTTPS 或内网地址");
  const content = `验证码：${code}，有效期5分钟。请妥善保管，切勿告知他人。`;
  const url = new URL(endpoint);
  url.search = new URLSearchParams({ appId, password, type: "1", destnumber: phone, longcode: "", content, sign: "" }).toString();
  const response = await fetch(url, { method: "GET", signal: AbortSignal.timeout(10_000) });
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.data !== true || (result?.code !== undefined && result.code !== 0)) {
    // Deliberately log only gateway result metadata, never request query values.
    console.error("Bestone SMS gateway rejected request", { httpStatus: response.status, code: result?.code, data: result?.data, message: result?.message });
    throw new Error("短信服务暂时不可用");
  }
}
async function sendLoginCode(phone, code) {
  if (config.smsProvider === "disabled") throw new Error("短信服务尚未配置");
  if (config.smsProvider === "bestone") return sendBestoneSms(phone, code);
  if (config.smsProvider === "tencent") return sendTencentSms(phone, code);
  throw new Error("不支持的短信服务商配置");
}
const promptDefinitions = {
  [LAWYER_AGENT_PROMPT_KEY]: { content: LAWYER_AGENT_PROMPT, changeNote: "律师辅助 Planner 提示词" },
  [LAWYER_RESPONSE_PROMPT_KEY]: { content: LAWYER_RESPONSE_PROMPT, changeNote: "压缩任务包律师回复提示词" },
  [LAWYER_CORE_PROMPT_KEY]: { content: LAWYER_CORE_PROMPT, changeNote: "律师辅助核心判断提示词" },
};
const promptCache = new Map();
async function activePromptFor(tenantId, promptKey) {
  const definition = promptDefinitions[promptKey];
  if (!definition) throw new Error("未知提示词配置");
  const cacheKey = `${tenantId}:${promptKey}`;
  const cached = promptCache.get(cacheKey);
  if (cached?.expiresAt > Date.now()) return cached.value;
  const [rows] = await db.execute("SELECT pv.id, pv.content, pv.version FROM active_prompt_versions apv JOIN prompt_versions pv ON pv.id = apv.prompt_version_id WHERE apv.tenant_id = ? AND apv.prompt_key = ? LIMIT 1", [tenantId, promptKey]);
  let prompt = rows[0];
  if (!prompt) {
    await withDatabaseLock(lockName("prompt", tenantId), async (connection) => {
      const [existing] = await connection.execute("SELECT prompt_version_id FROM active_prompt_versions WHERE tenant_id = ? AND prompt_key = ? LIMIT 1", [tenantId, promptKey]);
      if (!existing.length) {
        const [legacyActive] = await connection.execute("SELECT id FROM prompt_versions WHERE tenant_id = ? AND prompt_key = ? AND status = 'active' ORDER BY version DESC LIMIT 1", [tenantId, promptKey]);
        if (legacyActive[0]) {
          await connection.execute("INSERT INTO active_prompt_versions (tenant_id, prompt_key, prompt_version_id) VALUES (?, ?, ?)", [tenantId, promptKey, legacyActive[0].id]);
          return;
        }
        const promptId = id();
        await connection.beginTransaction();
        try {
          await connection.execute("INSERT INTO prompt_versions (id, tenant_id, prompt_key, version, status, content, content_hash, change_note, activated_at) VALUES (?, ?, ?, 1, 'active', ?, ?, ?, NOW())", [promptId, tenantId, promptKey, definition.content, createHash("sha256").update(definition.content).digest("hex"), definition.changeNote]);
          await connection.execute("INSERT INTO active_prompt_versions (tenant_id, prompt_key, prompt_version_id) VALUES (?, ?, ?)", [tenantId, promptKey, promptId]);
          await connection.commit();
        } catch (cause) { await connection.rollback(); throw cause; }
      }
    });
    const [created] = await db.execute("SELECT pv.id, pv.content, pv.version FROM active_prompt_versions apv JOIN prompt_versions pv ON pv.id = apv.prompt_version_id WHERE apv.tenant_id = ? AND apv.prompt_key = ? LIMIT 1", [tenantId, promptKey]);
    prompt = created[0];
  }
  if (!prompt) throw new Error("咨询提示词未配置");
  const value = { id: prompt.id, content: prompt.content, version: Number(prompt.version) };
  promptCache.set(cacheKey, { value, expiresAt: Date.now() + 60_000 });
  return value;
}

const emptyCaseState = () => ({ user_goal: "", case_type: "", legal_issues: [], known_facts: [], confirmed_facts: [], uncertain_facts: [], missing_facts: [], evidence: [], laws_used: [], cases_used: [], current_stage: "INTENT", last_action: "", conversation_summary: "" });
function normalizeCaseState(value) {
  const state = { ...emptyCaseState(), ...(value && typeof value === "object" ? value : {}) };
  for (const key of ["legal_issues", "known_facts", "confirmed_facts", "uncertain_facts", "missing_facts", "evidence", "laws_used", "cases_used"]) if (!Array.isArray(state[key])) state[key] = [];
  return state;
}
async function callModel(messages, temperature = config.aiTemperature, { contextChars = 0 } = {}) {
  const prepareStartedAt = performance.now();
  const requestBody = { model: process.env.AI_MODEL, temperature, stream: false, messages, ...(config.aiThinkingType ? { thinking: { type: config.aiThinkingType } } : {}) };
  const promptChars = messages.reduce((total, message) => total + String(message.content ?? "").length, 0);
  const body = JSON.stringify(requestBody);
  const requestPrepareMs = Math.round(performance.now() - prepareStartedAt);
  const modelStartedAt = performance.now();
  const response = await fetch(`${String(process.env.AI_BASE_URL).replace(/\/$/, "")}/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${process.env.AI_API_KEY}` }, body, signal: AbortSignal.timeout(config.aiTimeout) });
  if (!response.ok) throw new Error("模型服务暂时不可用");
  const model = await response.json(); const content = model.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("模型返回格式无效");
  const usage = model.usage ?? {};
  const inputTokens = Number.isFinite(Number(usage.prompt_tokens)) ? Number(usage.prompt_tokens) : null;
  const outputTokens = Number.isFinite(Number(usage.completion_tokens)) ? Number(usage.completion_tokens) : null;
  const totalTokens = Number.isFinite(Number(usage.total_tokens)) ? Number(usage.total_tokens) : inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null;
  return {
    content: content.trim(),
    metrics: {
      request_prepare_ms: requestPrepareMs,
      ttft_ms: null,
      ttft_unavailable: true,
      generation_ms: null,
      model_total_ms: Math.round(performance.now() - modelStartedAt),
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: totalTokens,
      model: String(model.model ?? process.env.AI_MODEL ?? "unknown"),
      finish_reason: model.choices?.[0]?.finish_reason ?? null,
      stream: false,
      message_count: messages.length,
      prompt_chars: promptChars,
      context_chars: contextChars,
    },
  };
}
function legalToolHeaders() {
  if (![config.legalToolsAppId, config.legalToolsAppSecret].every((value) => value && !value.startsWith("REPLACE_"))) throw new Error("法律工具服务未完成配置");
  return { "content-type": "application/json", "x-app-id": config.legalToolsAppId, "x-app-secret": config.legalToolsAppSecret };
}
async function searchLaw(query) {
  if (!lawSearchEnabled) return [];
  const endpoint = process.env.LAW_SEARCH_ENDPOINT;
  if (!endpoint || endpoint.startsWith("REPLACE_")) throw new Error("法条查询服务未完成配置");
  const response = await fetch(endpoint, { method: "POST", headers: legalToolHeaders(), body: JSON.stringify({ question: query, top_n: 5 }), signal: AbortSignal.timeout(config.lawSearchTimeout) });
  if (!response.ok) throw new Error("法条查询服务暂时不可用");
  const result = await response.json();
  if (result?.success !== true || !["00", "0"].includes(String(result?.code ?? ""))) throw new Error("法条查询服务暂时不可用");
  const laws = Array.isArray(result.data) ? result.data : [];
  return laws.slice(0, 5).map((law) => ({ name: String(law.legal_name ?? ""), article: String(law.article_number ?? ""), text: String(law.Articles ?? "").slice(0, 3000), region: String(law.region ?? ""), score: Number(law.score ?? 0) })).filter((law) => law.name && law.article && law.text);
}
async function searchCases({ keywordText, factText, intentText }) {
  if (!caseSearchEnabled) return [];
  const endpoint = process.env.CASE_SEARCH_ENDPOINT;
  if (!endpoint || endpoint.startsWith("REPLACE_")) throw new Error("类案查询服务未完成配置");
  const response = await fetch(endpoint, { method: "POST", headers: legalToolHeaders(), body: JSON.stringify({ keyword_text: keywordText || null, fact_text: factText || null, intent_text: intentText || null, top_k: 3, score_threshold: 0.45 }), signal: AbortSignal.timeout(config.caseSearchTimeout) });
  if (!response.ok) throw new Error("类案查询服务暂时不可用");
  const result = await response.json();
  if (Number(result?.code) !== 0 || !Array.isArray(result.data)) throw new Error("类案查询服务暂时不可用");
  return result.data.slice(0, 3).map((item) => {
    const content = item?.content && typeof item.content === "object" ? item.content : {};
    return {
      id: String(item?.id ?? content.id ?? ""), score: Number(item?.score ?? 0), keyword: String(content.keyword ?? ""), fact_summary: String(content.fact_summary ?? "").slice(0, 2000), intent_target: String(content.intent_target ?? ""), assessment_conclusion: String(content.assessment_conclusion ?? "").slice(0, 1600), assessment_reasoning: String(content.assessment_reasoning ?? "").slice(0, 2000), law_refs: Array.isArray(content.law_refs) ? content.law_refs.map(String).slice(0, 8) : [], action_strategy: String(content.action_strategy ?? "").slice(0, 1600), action_steps: Array.isArray(content.action_steps) ? content.action_steps.map(String).slice(0, 8) : [], risk_notes: String(content.risk_notes ?? "").slice(0, 1200), conversation_time: String(item?.conversation_time ?? content.conversation_time ?? "")
    };
  }).filter((item) => item.fact_summary || item.assessment_conclusion);
}
function routeConsultation(text) {
  const asksLaw = /(?:具体)?(?:法律)?依据|具体法条|法条(?:全文|依据)?|条文|法律规定|法律条款|相关(?:法律)?条款|核验(?:法条|法律|依据)?|核查(?:法条|法律|依据)?|第[一二三四五六七八九十百千\d]+条/.test(text);
  const asksCase = /类案|相似案例|类似案例|相似案件|类似案件|裁判思路|判例|案例参考|法院(?:一般|通常)怎么处理|法院(?:一般|通常)怎么判|法院(?:一般|通常)如何认定/.test(text);
  const asksAdvice = /建议|怎么处理|如何处理|下一步|处理路径|风险|能否|是否|怎么办/.test(text);
  const detailedFacts = text.length >= 120;
  // 工具只在律师明确索要资料时调用；普通案情判断不为外部检索等待。
  const useLaw = lawSearchEnabled && asksLaw;
  const useCases = caseSearchEnabled && asksCase;
  const intent = asksLaw && asksCase ? "LAW_AND_CASE" : asksLaw ? "LAW" : asksCase ? "CASE" : asksAdvice ? "ADVICE" : "CLARIFY";
  const storedRoute = asksLaw ? "law" : asksCase ? "case" : asksAdvice ? "advice" : "clarify";
  return { intent, storedRoute, detailedFacts, asksLaw, asksCase, useLaw, useCases };
}
const businessTypeRules = [
  ["劳动争议", /劳动|工资|加班|工伤|社保|辞退|解除劳动|竞业|劳动合同/],
  ["婚姻家事", /离婚|婚姻|夫妻|抚养|赡养|继承|遗嘱|彩礼|家暴|监护/],
  ["合同纠纷", /合同|违约|履行|定金|租赁|借款|欠款|债权|担保|保证人/],
  ["侵权损害", /侵权|损害|赔偿|人身损害|名誉|隐私|高空抛物|动物致害/],
  ["房产与物业", /房屋|房产|买房|卖房|物业|业主|装修|拆迁|不动产|抵押登记/],
  ["公司商事", /公司|股东|股权|董事|合伙|清算|破产|出资|公司治理|商业秘密/],
  ["消费者权益", /消费者|消费|假货|退货|网购|电商|产品质量|食品安全|预付卡/],
  ["交通事故", /交通事故|车祸|机动车|交强险|交通肇事|事故认定/],
  ["刑事法律", /刑事|犯罪|拘留|逮捕|取保|诈骗|盗窃|故意伤害|量刑/],
  ["行政争议", /行政处罚|行政复议|行政诉讼|政府信息公开|行政许可|征收决定/],
  ["知识产权", /商标|专利|著作权|版权|知识产权|不正当竞争/],
];
function classifyBusinessType(text, previousBusinessType = "") {
  for (const [businessType, pattern] of businessTypeRules) if (pattern.test(text)) return { businessType, source: "rule" };
  const followup = text.length <= 30 && /^(那|再|继续|帮我|请)?\s*(查|找|看|给|检索|补充)?.*(法条|条文|依据|类案|案例)/.test(text);
  if (followup && previousBusinessType && previousBusinessType !== "其他/待确认") return { businessType: previousBusinessType, source: "inherited" };
  if (/法条|条文|法律依据|第[一二三四五六七八九十百千\d]+条/.test(text)) return { businessType: "法条检索", source: "rule" };
  return { businessType: "其他/待确认", source: "fallback" };
}
function mergeTaskPlanIntoCaseState(state, taskPlan, message, laws, cases) {
  const nextState = normalizeCaseState(state);
  const patch = taskPlan.case_state_patch ?? {};
  nextState.user_goal = String(patch.user_goal ?? taskPlan.core_issue ?? nextState.user_goal).slice(0, 600);
  nextState.legal_issues = [...new Set([...nextState.legal_issues, ...taskPlan.user_questions])].slice(-12);
  nextState.known_facts = [...new Set([...nextState.known_facts, ...taskPlan.confirmed_facts, redactSensitive(message)])].slice(-12);
  nextState.confirmed_facts = [...new Set([...nextState.confirmed_facts, ...taskPlan.confirmed_facts])].slice(-12);
  nextState.uncertain_facts = [...new Set([...nextState.uncertain_facts, ...taskPlan.user_legal_evaluations])].slice(-12);
  nextState.missing_facts = taskPlan.key_fact_gap ? [taskPlan.key_fact_gap] : nextState.missing_facts;
  nextState.laws_used = laws;
  nextState.cases_used = cases;
  nextState.current_stage = taskPlan.information_status === "KEY_FACT_MISSING" ? "FACT_COLLECTION" : "LEGAL_ANALYSIS";
  nextState.last_action = laws.length || cases.length ? "RETRIEVE_AND_ANSWER" : "ANSWER";
  nextState.conversation_summary = taskPlan.core_issue;
  return nextState;
}
async function runLegalAgent(message, priorState, prompts, options = {}) {
  if (!aiEnabled) throw new Error("法律咨询服务尚未配置");
  const retrieve = options.retrieve !== false;
  const state = normalizeCaseState(priorState); const sanitizedMessage = redactSensitive(message);
  const fallbackPlan = createFallbackTaskPlan(sanitizedMessage, state);
  const stageTimings = {};
  const factSummary = compactCaseFacts(state);
  const plannerStartedAt = performance.now();
  const plannerContext = JSON.stringify({ current_question: sanitizedMessage, relevant_facts: factSummary });
  const plannerResult = await callModel([{ role: "system", content: prompts.agent.content }, { role: "user", content: plannerContext }], 0.1, { contextChars: plannerContext.length });
  const rawTaskPlan = plannerResult.content;
  stageTimings.planner_ms = Math.round(performance.now() - plannerStartedAt);
  stageTimings.v2a = plannerResult.metrics;
  const taskPlan = parseTaskPlan(rawTaskPlan, fallbackPlan);
  const route = routeConsultation(sanitizedMessage);
  const selectedTools = retrieve ? selectToolsForTaskPlan(taskPlan, { law_search: lawSearchEnabled, case_search: caseSearchEnabled }, { law_search: route.asksLaw, case_search: route.asksCase }) : [];
  const retrievalContext = [...factSummary.known_facts, sanitizedMessage].join("\n").slice(-2200);
  const caseKeywordText = sanitizedMessage.slice(0, 1000);
  const timedTool = async (name, selected, search) => {
    if (!selected) { stageTimings.tools ??= {}; stageTimings.tools[name] = { triggered: false, status: "not_triggered", elapsed_ms: null, timeout: false, result_count: 0 }; return []; }
    const startedAt = performance.now();
    try {
      const result = await search();
      const elapsedMs = Math.round(performance.now() - startedAt);
      stageTimings.tools ??= {}; stageTimings.tools[name] = { triggered: true, status: "success", elapsed_ms: elapsedMs, timeout: false, result_count: result.length };
      stageTimings[`${name}_search_ms`] = elapsedMs;
      return result;
    } catch (error) {
      const elapsedMs = Math.round(performance.now() - startedAt);
      const timeout = error?.name === "TimeoutError" || /aborted due to timeout/i.test(String(error?.message ?? ""));
      stageTimings.tools ??= {}; stageTimings.tools[name] = { triggered: true, status: timeout ? "timeout" : "error", elapsed_ms: elapsedMs, timeout, result_count: 0 };
      stageTimings[`${name}_search_ms`] = elapsedMs;
      throw error;
    }
  };
  const [lawResult, caseResult] = retrieve ? await Promise.allSettled([
    timedTool("law", selectedTools.includes("law_search"), () => searchLaw(retrievalContext)),
    timedTool("case", selectedTools.includes("case_search"), () => searchCases({ keywordText: caseKeywordText, factText: retrievalContext, intentText: taskPlan.core_issue || state.user_goal || "根据事实判断权利与处理路径" })),
  ]) : [null, null];
  // 工具不可用时仍交付模型答复，不能让一次外部检索故障中断坐席通话。
  const laws = lawResult?.status === "fulfilled" ? lawResult.value : [];
  const cases = caseResult?.status === "fulfilled" ? caseResult.value : [];
  const nextState = mergeTaskPlanIntoCaseState(state, taskPlan, sanitizedMessage, laws, cases);
  const responderStartedAt = performance.now();
  const responderContext = JSON.stringify({
    CURRENT_QUESTION: sanitizedMessage,
    TASK_PLAN: compactTaskPlan(taskPlan),
    RELEVANT_FACTS: compactCaseFacts(nextState),
    TOOL_RESULTS: compactToolResults({ laws, cases }),
    RESPONSE_DEPTH: taskPlan.answer_depth,
  });
  const responderResult = await callModel([{ role: "system", content: prompts.response.content }, { role: "user", content: responderContext }], config.aiTemperature, { contextChars: responderContext.length });
  const reply = responderResult.content;
  stageTimings.responder_ms = Math.round(performance.now() - responderStartedAt);
  stageTimings.v2b = responderResult.metrics;
  const toolFailures = [
    ...(lawResult?.status === "rejected" ? [{ component: "law_search", error: lawResult.reason }] : []),
    ...(caseResult?.status === "rejected" ? [{ component: "case_search", error: caseResult.reason }] : []),
  ];
  return { action: laws.length || cases.length ? "RETRIEVE_AND_ANSWER" : "ANSWER", route: route.storedRoute, case_state: nextState, matched_laws: laws, matched_cases: cases, suggested_reply: reply, _taskPlan: taskPlan, _toolFailures: toolFailures, _stageTimings: stageTimings };
}

function safeErrorMessage(exception) {
  return redactSensitive(String(exception instanceof Error ? exception.message : exception ?? "未知错误"))
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [已脱敏]")
    .slice(0, 1000);
}
async function recordServiceError(exception, component, requestId, session = null, errorCode = "INTERNAL_ERROR") {
  if (exception && typeof exception === "object") {
    if (recordedErrors.has(exception)) return;
    recordedErrors.add(exception);
  }
  try {
    const occurredAt = now();
    const expiresAt = new Date(occurredAt.getTime() + config.internalErrorLogDays * 86_400_000);
    await db.execute("INSERT INTO service_error_logs (tenant_id, user_id, request_id, component, error_code, message, occurred_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [session?.tenant_id ?? config.tenantId ?? null, session?.user_id ?? null, requestId, component, errorCode, safeErrorMessage(exception), occurredAt, expiresAt]);
  } catch (loggingError) {
    console.error("Failed to persist sanitized service error", safeErrorMessage(loggingError));
  }
}
async function purgeExpiredInternalData() {
  await db.execute("DELETE FROM service_error_logs WHERE expires_at < NOW() LIMIT 5000");
  await db.execute("DELETE FROM verification_codes WHERE expires_at < DATE_SUB(NOW(), INTERVAL 1 DAY) LIMIT 5000");
  await db.execute("DELETE FROM sessions WHERE (expires_at < NOW() OR revoked_at < DATE_SUB(NOW(), INTERVAL 30 DAY)) LIMIT 5000");
  const contentPlaceholder = encryptContent("[咨询正文已按数据保留规则清理]");
  await db.execute("UPDATE consultation_entries SET question_ciphertext = ?, answer_ciphertext = ?, matched_laws = NULL, matched_cases = NULL, content_purged_at = NOW() WHERE content_expires_at < NOW() AND content_purged_at IS NULL LIMIT 1000", [contentPlaceholder, contentPlaceholder]);
}

function jsonValue(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") { try { return JSON.parse(value); } catch { return fallback; } }
  return value;
}
function publicEntry(row) {
  return {
    id: row.id,
    contextId: row.context_id,
    question: decryptContent(row.question_ciphertext),
    answer: row.answer_ciphertext ? decryptContent(row.answer_ciphertext) : "",
    businessType: row.business_type,
    status: row.status,
    contentPurged: Boolean(row.content_purged_at),
    time: row.asked_at,
    matched_laws: jsonValue(row.matched_laws, []),
    matched_cases: jsonValue(row.matched_cases, []),
  };
}
async function prepareConsultation(session, message, clientRequestId) {
  return withDatabaseLock(lockName("consult", `${session.tenant_id}:${session.user_id}`), async (connection) => {
    await connection.beginTransaction();
    try {
      const [duplicates] = await connection.execute("SELECT * FROM consultation_entries WHERE tenant_id = ? AND user_id = ? AND client_request_id = ? LIMIT 1", [session.tenant_id, session.user_id, clientRequestId]);
      if (duplicates[0]) {
        await connection.commit();
        if (duplicates[0].status === "answered") return { duplicate: true, entry: publicEntry(duplicates[0]) };
        throw new PublicError(409, duplicates[0].status === "processing" ? "该问题正在处理中，请勿重复发送" : "上次处理未成功，请重新发送");
      }
      const [contexts] = await connection.execute("SELECT cc.* FROM active_consultation_contexts acc JOIN consultation_contexts cc ON cc.id = acc.context_id WHERE acc.tenant_id = ? AND acc.user_id = ? LIMIT 1 FOR UPDATE", [session.tenant_id, session.user_id]);
      let context = contexts[0];
      if (!context) {
        context = { id: id(), case_state: emptyCaseState() };
        await connection.execute("INSERT INTO consultation_contexts (id, tenant_id, user_id, status, case_state, started_at) VALUES (?, ?, ?, 'active', ?, NOW())", [context.id, session.tenant_id, session.user_id, JSON.stringify(context.case_state)]);
        await connection.execute("INSERT INTO active_consultation_contexts (tenant_id, user_id, context_id) VALUES (?, ?, ?)", [session.tenant_id, session.user_id, context.id]);
      }
      const [priorRows] = await connection.execute("SELECT business_type FROM consultation_entries WHERE context_id = ? AND status = 'answered' ORDER BY sequence_no DESC LIMIT 1", [context.id]);
      const previousBusinessType = priorRows[0]?.business_type ?? "";
      const classification = classifyBusinessType(message, previousBusinessType);
      const route = routeConsultation(redactSensitive(message));
      const [sequences] = await connection.execute("SELECT COALESCE(MAX(sequence_no), 0) + 1 AS next_sequence FROM consultation_entries WHERE context_id = ?", [context.id]);
      const entryId = id();
      const contentExpiresAt = new Date(Date.now() + config.consultationContentDays * 86_400_000);
      await connection.execute("INSERT INTO consultation_entries (id, tenant_id, context_id, user_id, group_id, client_request_id, sequence_no, question_ciphertext, business_type, classification_source, route, status, asked_at, content_expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'processing', NOW(), ?)", [entryId, session.tenant_id, context.id, session.user_id, session.group_id ?? null, clientRequestId, Number(sequences[0].next_sequence), encryptContent(message), classification.businessType, classification.source, route.storedRoute, contentExpiresAt]);
      await connection.commit();
      return { duplicate: false, entryId, contextId: context.id, caseState: jsonValue(context.case_state, emptyCaseState()), classification };
    } catch (cause) { await connection.rollback(); throw cause; }
  });
}
async function completeConsultation(prepared, agent, prompt, stageTimings) {
  await db.execute("UPDATE consultation_entries SET answer_ciphertext = ?, route = ?, matched_laws = ?, matched_cases = ?, stage_timings = ?, prompt_version_id = ?, status = 'answered', answered_at = NOW() WHERE id = ? AND status = 'processing'", [encryptContent(agent.suggested_reply), agent.route, JSON.stringify(agent.matched_laws ?? []), JSON.stringify(agent.matched_cases ?? []), JSON.stringify(stageTimings), prompt.id, prepared.entryId]);
  await db.execute("UPDATE consultation_contexts SET case_state = ? WHERE id = ?", [JSON.stringify(agent.case_state ?? emptyCaseState()), prepared.contextId]);
}
async function failConsultation(entryId, code = "CONSULTATION_FAILED") {
  if (entryId) await db.execute("UPDATE consultation_entries SET status = 'failed', error_code = ? WHERE id = ? AND status = 'processing'", [code, entryId]);
}
function decodeHistoryCursor(cursor) {
  if (typeof cursor !== "string" || cursor.length > 200) return null;
  try { const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")); return value && typeof value.time === "string" && typeof value.id === "string" ? value : null; } catch { return null; }
}
async function consultationHistory(session, cursor = null) {
  const decoded = decodeHistoryCursor(cursor);
  const sql = `SELECT id, context_id, question_ciphertext, answer_ciphertext, business_type, status, asked_at, matched_laws, matched_cases FROM consultation_entries WHERE tenant_id = ? AND user_id = ?${decoded ? " AND (asked_at < ? OR (asked_at = ? AND id < ?))" : ""} ORDER BY asked_at DESC, id DESC LIMIT 101`;
  const params = decoded ? [session.tenant_id, session.user_id, new Date(decoded.time), new Date(decoded.time), decoded.id] : [session.tenant_id, session.user_id];
  const [rows] = await db.execute(sql, params);
  const page = rows.slice(0, 100);
  const last = page.at(-1);
  const nextCursor = rows.length > 100 && last ? Buffer.from(JSON.stringify({ time: new Date(last.asked_at).toISOString(), id: last.id })).toString("base64url") : null;
  const [active] = await db.execute("SELECT context_id FROM active_consultation_contexts WHERE tenant_id = ? AND user_id = ? LIMIT 1", [session.tenant_id, session.user_id]);
  return { entries: page.slice().reverse().map(publicEntry), activeContextId: active[0]?.context_id ?? null, nextCursor };
}
async function clearConsultationContext(session) {
  return withDatabaseLock(lockName("consult", `${session.tenant_id}:${session.user_id}`), async (connection) => {
    await connection.beginTransaction();
    try {
      const [active] = await connection.execute("SELECT context_id FROM active_consultation_contexts WHERE tenant_id = ? AND user_id = ? FOR UPDATE", [session.tenant_id, session.user_id]);
      if (active[0]) await connection.execute("UPDATE consultation_contexts SET status = 'closed', closed_at = NOW() WHERE id = ?", [active[0].context_id]);
      await connection.execute("DELETE FROM active_consultation_contexts WHERE tenant_id = ? AND user_id = ?", [session.tenant_id, session.user_id]);
      await connection.commit();
    } catch (cause) { await connection.rollback(); throw cause; }
  });
}

const server = createServer(async (request, response) => {
  const requestId = id();
  try {
    if (request.method === "POST" && config.origin && request.headers.origin !== config.origin) return error(response, 403, "来源不被允许");
    if (request.method === "GET" && ["/healthz", "/api/healthz"].includes(request.url)) return json(response, 200, { ok: true });
    if (request.method === "GET" && ["/readyz", "/api/readyz"].includes(request.url)) {
      await db.execute("SELECT 1");
      return json(response, 200, { ok: true });
    }
    if (request.method !== "POST") return error(response, 404, "接口不存在");
    const body = await bodyOf(request);
    if (request.url === "/api/v1/auth/sms/send") {
      if (!validPhone(body.phone) || body.purpose !== "login") return error(response, 400, "手机号或用途无效");
      const tenantId = config.tenantId;
      await withDatabaseLock(lockName("sms", `${tenantId}:${phoneHash(body.phone)}`), async (connection) => {
        const [rateRows] = await connection.execute("SELECT COUNT(*) AS count FROM verification_codes WHERE tenant_id = ? AND phone = ? AND purpose = 'login' AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)", [tenantId, body.phone]);
        if (Number(rateRows[0].count) >= 5) throw new PublicError(429, "请求过于频繁，请稍后再试");
        const [recentRows] = await connection.execute("SELECT id FROM verification_codes WHERE tenant_id = ? AND phone = ? AND purpose = 'login' AND created_at > DATE_SUB(NOW(), INTERVAL 60 SECOND) LIMIT 1", [tenantId, body.phone]);
        if (recentRows.length) throw new PublicError(429, "请稍后再试");
        const code = String(Math.floor(100000 + Math.random() * 900000));
        await sendLoginCode(body.phone, code);
        await connection.execute("INSERT INTO verification_codes (id, tenant_id, phone, purpose, code_hash, expires_at, attempts) VALUES (?, ?, ?, 'login', ?, DATE_ADD(NOW(), INTERVAL 5 MINUTE), 0)", [id(), tenantId, body.phone, codeHash(body.phone, code)]);
      });
      await audit(tenantId, "auth.sms.sent", request, { phoneHash: phoneHash(body.phone) });
      return json(response, 202, { accepted: true });
    }
    if (request.url === "/api/v1/auth/sms/verify") {
      if (!validPhone(body.phone) || !/^\d{6}$/.test(body.code) || body.purpose !== "login") return error(response, 400, "手机号或验证码无效");
      const result = await withDatabaseLock(lockName("verify", `${config.tenantId}:${phoneHash(body.phone)}`), async (connection) => {
        await connection.beginTransaction();
        try {
          const [codes] = await connection.execute("SELECT id, tenant_id, code_hash, attempts FROM verification_codes WHERE tenant_id = ? AND phone = ? AND purpose = 'login' AND consumed_at IS NULL AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1 FOR UPDATE", [config.tenantId, body.phone]);
          const record = codes[0]; const expected = Buffer.from(record?.code_hash ?? "", "hex"); const actual = Buffer.from(codeHash(body.phone, body.code), "hex");
          const matches = expected.length === actual.length && timingSafeEqual(expected, actual);
          if (!record || record.attempts >= 5 || !matches) { if (record) await connection.execute("UPDATE verification_codes SET attempts = attempts + 1 WHERE id = ?", [record.id]); await connection.commit(); return null; }
          const [users] = await connection.execute("SELECT id, tenant_id, display_name, phone, role, status FROM users WHERE tenant_id = ? AND phone = ? LIMIT 1", [config.tenantId, body.phone]);
          let user = users[0];
          if (user && user.status !== "active") { await connection.rollback(); return { blocked: true, userId: user.id }; }
          if (!user) {
            user = { id: id(), tenant_id: config.tenantId, display_name: `用户${body.phone.slice(-4)}`, phone: body.phone, role: "agent" };
            await connection.execute("INSERT INTO users (id, tenant_id, phone, display_name, role, status) VALUES (?, ?, ?, ?, ?, 'active')", [user.id, user.tenant_id, user.phone, user.display_name, user.role]);
          }
          if (record) await connection.execute("UPDATE verification_codes SET consumed_at = NOW() WHERE id = ?", [record.id]);
          await connection.execute("UPDATE sessions SET revoked_at = NOW() WHERE tenant_id = ? AND user_id = ? AND revoked_at IS NULL", [config.tenantId, user.id]);
          const token = randomBytes(32).toString("base64url"); const expiresAt = new Date(Date.now() + config.sessionMinutes * 60_000);
          await connection.execute("INSERT INTO sessions (id, tenant_id, user_id, token_hash, user_agent, ip_hash, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, NOW(), ?)", [id(), config.tenantId, user.id, hash(token, config.sessionPepper), String(request.headers["user-agent"] ?? "").slice(0, 512), ipHash(request), expiresAt]);
          await connection.execute("UPDATE users SET last_login_at = NOW() WHERE id = ?", [user.id]); await connection.commit();
          return { user, token, expiresAt };
        } catch (cause) { await connection.rollback(); throw cause; }
      });
      if (!result) { await audit(config.tenantId, "auth.login.failed", request, { phoneHash: phoneHash(body.phone), reason: "invalid_or_expired_code" }); return error(response, 401, "验证码无效或已过期"); }
      if (result.blocked) { await audit(config.tenantId, "auth.login.blocked", request, { phoneHash: phoneHash(body.phone), reason: "account_disabled" }, result.userId); return error(response, 403, "该账号已被禁用，请联系管理员"); }
      await audit(config.tenantId, "auth.login.succeeded", request, {}, result.user.id); setSessionCookie(response, result.token, result.expiresAt);
      return json(response, 200, { user: { id: result.user.id, displayName: result.user.display_name, phone: result.user.phone, role: result.user.role } });
    }
    if (request.url === "/api/v1/auth/logout") { const session = await sessionFor(request); if (session) { await db.execute("UPDATE sessions SET revoked_at = NOW() WHERE id = ?", [session.id]); await audit(session.tenant_id, "auth.logout", request, {}, session.user_id); } response.setHeader("set-cookie", `${config.cookieName}=; Path=/; HttpOnly;${cookieSecure ? " Secure;" : ""} SameSite=Strict; Max-Age=0`); return json(response, 204, {}); }
    if (request.url === "/api/v1/auth/me") {
      const session = await sessionFor(request); if (!session) return error(response, 401, "登录已过期，请重新登录");
      await refreshSession(request, response, session);
      return json(response, 200, { user: { id: session.user_id, displayName: session.display_name, phone: session.phone, role: session.role } });
    }
    if (request.url === "/api/v1/team/overview") {
      const session = await sessionFor(request); if (!canManageTeam(session)) return error(response, 403, "无权查看团队信息");
      const isSystemAdmin = session.role === "system_admin";
      const scope = isSystemAdmin ? [session.tenant_id] : [session.tenant_id, session.group_id ?? ""];
      const groupClause = isSystemAdmin ? "" : " AND u.group_id = ?";
      const historicalGroupClause = isSystemAdmin ? "" : " AND ce.group_id = u.group_id";
      const [users] = await db.execute(`SELECT u.id, u.display_name, u.phone, u.role, u.status, u.group_id, u.last_login_at, g.name AS group_name, COUNT(ce.id) AS consultation_count FROM users u LEFT JOIN user_groups g ON g.id = u.group_id LEFT JOIN consultation_entries ce ON ce.user_id = u.id AND ce.tenant_id = u.tenant_id${historicalGroupClause} WHERE u.tenant_id = ? AND u.status <> 'deleted'${groupClause} GROUP BY u.id, g.name ORDER BY u.role = 'system_admin' DESC, u.status ASC, u.last_login_at DESC`, scope);
      const [groups] = await db.execute(isSystemAdmin ? "SELECT g.id, g.name, g.status, COUNT(u.id) AS member_count FROM user_groups g LEFT JOIN users u ON u.group_id = g.id AND u.status <> 'deleted' WHERE g.tenant_id = ? GROUP BY g.id ORDER BY g.created_at" : "SELECT g.id, g.name, g.status, COUNT(u.id) AS member_count FROM user_groups g LEFT JOIN users u ON u.group_id = g.id AND u.status <> 'deleted' WHERE g.tenant_id = ? AND g.id = ? GROUP BY g.id", scope);
      const categorySql = `SELECT ce.business_type, COUNT(*) AS count FROM consultation_entries ce WHERE ce.tenant_id = ?${isSystemAdmin ? "" : " AND ce.group_id = ?"} GROUP BY ce.business_type ORDER BY count DESC, ce.business_type`;
      const [businessTypes] = await db.execute(categorySql, scope);
      const activeCount = users.filter((user) => user.status === "active").length;
      const consultationCount = businessTypes.reduce((total, item) => total + Number(item.count), 0);
      return json(response, 200, { scope: isSystemAdmin ? "all" : "group", canManageRoles: isSystemAdmin, summary: { total: users.length, active: activeCount, consultations: consultationCount, groups: groups.length }, groups, businessTypes: businessTypes.map((item) => ({ name: item.business_type, count: Number(item.count) })), users: users.map((user) => ({ id: user.id, name: user.display_name, phone: user.phone.replace(/(\d{3})\d{4}(\d{4})/, "$1****$2"), role: user.role, status: user.status, groupId: user.group_id, groupName: user.group_name ?? "未加入成员组", lastLoginAt: user.last_login_at, consultationCount: Number(user.consultation_count) })) });
    }
    if (request.url === "/api/v1/team/user/status") {
      const session = await sessionFor(request); if (!canManageTeam(session)) return error(response, 403, "无权管理成员");
      if (typeof body.userId !== "string" || !["active", "disabled"].includes(body.status)) return error(response, 400, "成员或状态无效");
      const [rows] = await db.execute("SELECT id, role, group_id, status FROM users WHERE id = ? AND tenant_id = ? AND status <> 'deleted' LIMIT 1", [body.userId, session.tenant_id]); const target = rows[0];
      if (!target) return error(response, 404, "成员不存在");
      if (target.id === session.user_id || target.role === "system_admin") return error(response, 403, "不能修改该成员状态");
      if (session.role === "group_admin" && (target.group_id !== session.group_id || target.role !== "agent")) return error(response, 403, "只能管理本组普通用户");
      await db.execute("UPDATE users SET status = ? WHERE id = ?", [body.status, target.id]); if (body.status === "disabled") await db.execute("UPDATE sessions SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL", [target.id]);
      await audit(session.tenant_id, `team.member.${body.status}`, request, { targetUserId: target.id }, session.user_id);
      return json(response, 200, { updated: true });
    }
    if (request.url === "/api/v1/team/groups/create") {
      const session = await sessionFor(request); if (session?.role !== "system_admin") return error(response, 403, "仅系统管理员可新建成员组");
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (name.length < 2 || name.length > 80) return error(response, 400, "成员组名称应为 2 至 80 个字符");
      const groupId = id();
      try { await db.execute("INSERT INTO user_groups (id, tenant_id, name, status) VALUES (?, ?, ?, 'active')", [groupId, session.tenant_id, name]); }
      catch (cause) { if (cause?.code === "ER_DUP_ENTRY") throw new PublicError(409, "该成员组名称已存在"); throw cause; }
      await audit(session.tenant_id, "team.group.created", request, { groupId, name }, session.user_id);
      return json(response, 201, { id: groupId, name });
    }
    if (request.url === "/api/v1/team/groups/update") {
      const session = await sessionFor(request); if (session?.role !== "system_admin") return error(response, 403, "仅系统管理员可修改成员组");
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (typeof body.groupId !== "string" || name.length < 2 || name.length > 80) return error(response, 400, "成员组资料无效");
      try {
        const [result] = await db.execute("UPDATE user_groups SET name = ? WHERE id = ? AND tenant_id = ?", [name, body.groupId, session.tenant_id]);
        if (!result.affectedRows) return error(response, 404, "成员组不存在");
      } catch (cause) { if (cause?.code === "ER_DUP_ENTRY") throw new PublicError(409, "该成员组名称已存在"); throw cause; }
      await audit(session.tenant_id, "team.group.renamed", request, { groupId: body.groupId, name }, session.user_id);
      return json(response, 200, { updated: true });
    }
    if (request.url === "/api/v1/team/groups/delete") {
      const session = await sessionFor(request); if (session?.role !== "system_admin") return error(response, 403, "仅系统管理员可删除成员组");
      if (typeof body.groupId !== "string") return error(response, 400, "成员组无效");
      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();
        const [groups] = await connection.execute("SELECT id, name FROM user_groups WHERE id = ? AND tenant_id = ? FOR UPDATE", [body.groupId, session.tenant_id]);
        if (!groups.length) throw new PublicError(404, "成员组不存在");
        await connection.execute("UPDATE users SET group_id = NULL, role = CASE WHEN role = 'group_admin' THEN 'agent' ELSE role END WHERE tenant_id = ? AND group_id = ?", [session.tenant_id, body.groupId]);
        await connection.execute("DELETE FROM user_groups WHERE id = ? AND tenant_id = ?", [body.groupId, session.tenant_id]);
        await connection.commit();
      } catch (cause) { await connection.rollback(); throw cause; } finally { connection.release(); }
      await audit(session.tenant_id, "team.group.deleted", request, { groupId: body.groupId }, session.user_id);
      return json(response, 200, { deleted: true });
    }
    if (request.url === "/api/v1/team/users/create") {
      const session = await sessionFor(request); if (session?.role !== "system_admin") return error(response, 403, "仅系统管理员可预录入用户");
      const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
      const role = body.role;
      const groupId = typeof body.groupId === "string" && body.groupId ? body.groupId : null;
      if (!validPhone(body.phone) || displayName.length < 2 || displayName.length > 80 || !["agent", "group_admin"].includes(role)) return error(response, 400, "用户资料无效");
      if (role === "group_admin" && !groupId) return error(response, 400, "组长必须归属一个成员组");
      if (groupId) { const [groups] = await db.execute("SELECT id FROM user_groups WHERE id = ? AND tenant_id = ? AND status = 'active' LIMIT 1", [groupId, session.tenant_id]); if (!groups.length) return error(response, 400, "成员组不存在或已停用"); }
      const userId = id();
      try { await db.execute("INSERT INTO users (id, tenant_id, group_id, phone, display_name, role, status) VALUES (?, ?, ?, ?, ?, ?, 'active')", [userId, session.tenant_id, groupId, body.phone, displayName, role]); }
      catch (cause) { if (cause?.code === "ER_DUP_ENTRY") throw new PublicError(409, "该手机号已存在"); throw cause; }
      await audit(session.tenant_id, "team.member.created", request, { targetUserId: userId, role, groupId }, session.user_id);
      return json(response, 201, { id: userId });
    }
    if (request.url === "/api/v1/team/users/update") {
      const session = await sessionFor(request); if (session?.role !== "system_admin") return error(response, 403, "仅系统管理员可修改角色和分组");
      const role = body.role; const groupId = typeof body.groupId === "string" && body.groupId ? body.groupId : null;
      if (typeof body.userId !== "string" || !["agent", "group_admin"].includes(role)) return error(response, 400, "成员或角色无效");
      if (role === "group_admin" && !groupId) return error(response, 400, "组长必须归属一个成员组");
      const [targets] = await db.execute("SELECT id, role, group_id FROM users WHERE id = ? AND tenant_id = ? AND status <> 'deleted' LIMIT 1", [body.userId, session.tenant_id]); const target = targets[0];
      if (!target) return error(response, 404, "成员不存在");
      if (target.id === session.user_id || target.role === "system_admin") return error(response, 403, "系统管理员身份只能通过换绑手机号交接");
      if (groupId) { const [groups] = await db.execute("SELECT id FROM user_groups WHERE id = ? AND tenant_id = ? AND status = 'active' LIMIT 1", [groupId, session.tenant_id]); if (!groups.length) return error(response, 400, "成员组不存在或已停用"); }
      await db.execute("UPDATE users SET role = ?, group_id = ? WHERE id = ? AND tenant_id = ?", [role, groupId, target.id, session.tenant_id]);
      await audit(session.tenant_id, "team.member.assignment.updated", request, { targetUserId: target.id, previousRole: target.role, role, previousGroupId: target.group_id, groupId }, session.user_id);
      return json(response, 200, { updated: true });
    }
    if (request.url === "/api/v1/team/users/batch-update") {
      const session = await sessionFor(request); if (session?.role !== "system_admin") return error(response, 403, "仅系统管理员可批量修改成员");
      const updates = Array.isArray(body.updates) ? body.updates : [];
      if (!updates.length || updates.length > 100) return error(response, 400, "请选择 1 至 100 名成员");
      const uniqueIds = [...new Set(updates.map((item) => item?.userId))];
      if (uniqueIds.length !== updates.length || uniqueIds.some((value) => typeof value !== "string")) return error(response, 400, "成员列表无效");
      for (const item of updates) {
        if (!["agent", "group_admin"].includes(item.role)) return error(response, 400, "成员身份无效");
        if (item.role === "group_admin" && !item.groupId) return error(response, 400, "组长必须归属一个成员组");
      }
      const groupIds = [...new Set(updates.map((item) => item.groupId).filter(Boolean))];
      if (groupIds.length) {
        const placeholders = groupIds.map(() => "?").join(",");
        const [groups] = await db.execute(`SELECT id FROM user_groups WHERE tenant_id = ? AND status = 'active' AND id IN (${placeholders})`, [session.tenant_id, ...groupIds]);
        if (groups.length !== groupIds.length) return error(response, 400, "部分成员组不存在或已停用");
      }
      const placeholders = uniqueIds.map(() => "?").join(",");
      const [targets] = await db.execute(`SELECT id, role FROM users WHERE tenant_id = ? AND status <> 'deleted' AND id IN (${placeholders})`, [session.tenant_id, ...uniqueIds]);
      if (targets.length !== uniqueIds.length || targets.some((target) => target.role === "system_admin" || target.id === session.user_id)) return error(response, 403, "所选成员中包含不可修改的账号");
      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();
        for (const item of updates) await connection.execute("UPDATE users SET role = ?, group_id = ? WHERE id = ? AND tenant_id = ?", [item.role, item.groupId || null, item.userId, session.tenant_id]);
        await connection.commit();
      } catch (cause) { await connection.rollback(); throw cause; } finally { connection.release(); }
      await audit(session.tenant_id, "team.members.batch_assignment.updated", request, { targetUserIds: uniqueIds, count: uniqueIds.length }, session.user_id);
      return json(response, 200, { updated: uniqueIds.length });
    }
    if (request.url === "/api/v1/team/users/delete") {
      const session = await sessionFor(request); if (session?.role !== "system_admin") return error(response, 403, "仅系统管理员可删除账号");
      if (typeof body.userId !== "string") return error(response, 400, "成员无效");
      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();
        const [targets] = await connection.execute("SELECT id, role, status FROM users WHERE id = ? AND tenant_id = ? FOR UPDATE", [body.userId, session.tenant_id]); const target = targets[0];
        if (!target || target.status === "deleted") throw new PublicError(404, "成员不存在");
        if (target.id === session.user_id || target.role === "system_admin") throw new PublicError(403, "系统管理员账号不能删除");
        await connection.execute("UPDATE users SET phone = ?, display_name = '已删除用户', avatar_url = NULL, role = 'agent', group_id = NULL, status = 'deleted', deleted_at = NOW() WHERE id = ? AND tenant_id = ?", [`del:${target.id}`, target.id, session.tenant_id]);
        await connection.execute("UPDATE sessions SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL", [target.id]);
        await connection.commit();
      } catch (cause) { await connection.rollback(); throw cause; } finally { connection.release(); }
      await audit(session.tenant_id, "team.member.deleted", request, { targetUserId: body.userId }, session.user_id);
      return json(response, 200, { deleted: true });
    }
    if (request.url === "/api/v1/admin/prompts") {
      const session = await sessionFor(request); if (session?.role !== "system_admin") return error(response, 403, "仅系统管理员可管理提示词");
      const promptKey = typeof body.promptKey === "string" && promptDefinitions[body.promptKey] ? body.promptKey : LAWYER_RESPONSE_PROMPT_KEY;
      await activePromptFor(session.tenant_id, promptKey);
      const [versions] = await db.execute("SELECT pv.id, pv.version, pv.status, pv.content, pv.content_hash, pv.change_note, pv.activated_at, pv.created_at, (apv.prompt_version_id IS NOT NULL) AS is_active FROM prompt_versions pv LEFT JOIN active_prompt_versions apv ON apv.prompt_version_id = pv.id WHERE pv.tenant_id = ? AND pv.prompt_key = ? ORDER BY pv.version DESC LIMIT 30", [session.tenant_id, promptKey]);
      return json(response, 200, { promptKey, versions: versions.map((item) => ({ id: item.id, version: Number(item.version), status: item.status, content: item.content, contentHash: item.content_hash, changeNote: item.change_note, activatedAt: item.activated_at, createdAt: item.created_at, active: Boolean(item.is_active) })) });
    }
    if (request.url === "/api/v1/admin/prompts/publish") {
      const session = await sessionFor(request); if (session?.role !== "system_admin") return error(response, 403, "仅系统管理员可发布提示词");
      const promptKey = typeof body.promptKey === "string" && promptDefinitions[body.promptKey] ? body.promptKey : LAWYER_RESPONSE_PROMPT_KEY;
      const content = typeof body.content === "string" ? body.content.trim() : "";
      const changeNote = typeof body.changeNote === "string" ? body.changeNote.trim().slice(0, 500) : "";
      if (content.length < 100 || content.length > 50_000) return error(response, 400, "提示词长度应为 100 至 50000 个字符");
      const published = await withDatabaseLock(lockName("prompt", session.tenant_id), async (connection) => {
        await connection.beginTransaction();
        try {
          const [numbers] = await connection.execute("SELECT version FROM prompt_versions WHERE tenant_id = ? AND prompt_key = ? ORDER BY version DESC LIMIT 1 FOR UPDATE", [session.tenant_id, promptKey]);
          const promptId = id(); const version = Number(numbers[0]?.version ?? 0) + 1;
          await connection.execute("UPDATE prompt_versions pv JOIN active_prompt_versions apv ON apv.prompt_version_id = pv.id SET pv.status = 'archived' WHERE apv.tenant_id = ? AND apv.prompt_key = ?", [session.tenant_id, promptKey]);
          await connection.execute("INSERT INTO prompt_versions (id, tenant_id, prompt_key, version, status, content, content_hash, change_note, created_by_user_id, activated_at) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, NOW())", [promptId, session.tenant_id, promptKey, version, content, createHash("sha256").update(content).digest("hex"), changeNote || null, session.user_id]);
          await connection.execute("INSERT INTO active_prompt_versions (tenant_id, prompt_key, prompt_version_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE prompt_version_id = VALUES(prompt_version_id)", [session.tenant_id, promptKey, promptId]);
          await connection.commit(); return { promptId, version };
        } catch (cause) { await connection.rollback(); throw cause; }
      });
      promptCache.delete(`${session.tenant_id}:${promptKey}`);
      await audit(session.tenant_id, `prompt.${promptKey}.published`, request, { promptVersionId: published.promptId, version: published.version, contentHash: createHash("sha256").update(content).digest("hex") }, session.user_id);
      return json(response, 201, { id: published.promptId, version: published.version, promptKey });
    }
    if (request.url === "/api/v1/account/profile") {
      const session = await sessionFor(request); if (!session) return error(response, 401, "登录已过期，请重新登录");
      const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
      if (displayName.length < 2 || displayName.length > 80) return error(response, 400, "显示名称应为 2 至 80 个字符");
      await db.execute("UPDATE users SET display_name = ? WHERE id = ? AND tenant_id = ? AND status = 'active'", [displayName, session.user_id, session.tenant_id]);
      await audit(session.tenant_id, "account.profile.updated", request, { field: "display_name" }, session.user_id);
      return json(response, 200, { updated: true, displayName });
    }
    if (request.url === "/api/v1/account/phone/send") {
      const session = await sessionFor(request); if (!session) return error(response, 401, "登录已过期，请重新登录");
      const step = body.step; const phone = body.phone;
      if (!validPhone(phone) || !["old", "new"].includes(step)) return error(response, 400, "手机号或步骤无效");
      if (step === "old" && phone !== session.phone) return error(response, 400, "请输入当前绑定的手机号");
      if (step === "new" && phone === session.phone) return error(response, 400, "新手机号不能与当前手机号相同");
      await withDatabaseLock(lockName("phone", `${session.tenant_id}:${phoneHash(phone)}`), async (connection) => {
        if (step === "new") { const [users] = await connection.execute("SELECT id FROM users WHERE tenant_id = ? AND phone = ? LIMIT 1", [session.tenant_id, phone]); if (users.length) throw new PublicError(409, "该手机号已绑定其他账号"); }
        const [recent] = await connection.execute("SELECT id FROM verification_codes WHERE tenant_id = ? AND phone = ? AND purpose = 'change_phone' AND created_at > DATE_SUB(NOW(), INTERVAL 60 SECOND) LIMIT 1", [session.tenant_id, phone]);
        if (recent.length) throw new PublicError(429, "请稍后再试");
        const [hourly] = await connection.execute("SELECT COUNT(*) AS count FROM verification_codes WHERE tenant_id = ? AND phone = ? AND purpose = 'change_phone' AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)", [session.tenant_id, phone]);
        if (Number(hourly[0].count) >= 5) throw new PublicError(429, "请求过于频繁，请稍后再试");
        const code = String(Math.floor(100000 + Math.random() * 900000)); await sendLoginCode(phone, code);
        await connection.execute("INSERT INTO verification_codes (id, tenant_id, phone, purpose, code_hash, expires_at, attempts) VALUES (?, ?, ?, 'change_phone', ?, DATE_ADD(NOW(), INTERVAL 5 MINUTE), 0)", [id(), session.tenant_id, phone, codeHash(phone, code)]);
      });
      await audit(session.tenant_id, `account.phone_change.${step}_code_sent`, request, { phoneHash: phoneHash(phone) }, session.user_id);
      return json(response, 202, { accepted: true });
    }
    if (request.url === "/api/v1/account/phone/verify-old") {
      const session = await sessionFor(request); if (!session) return error(response, 401, "登录已过期，请重新登录");
      if (!validPhone(body.phone) || body.phone !== session.phone || !/^\d{6}$/.test(body.code)) return error(response, 400, "手机号或验证码无效");
      const verified = await withDatabaseLock(lockName("verify", `${session.tenant_id}:${phoneHash(body.phone)}`), async (connection) => {
        await connection.beginTransaction(); try {
          const [codes] = await connection.execute("SELECT id, code_hash, attempts FROM verification_codes WHERE tenant_id = ? AND phone = ? AND purpose = 'change_phone' AND consumed_at IS NULL AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1 FOR UPDATE", [session.tenant_id, body.phone]);
          const record = codes[0]; const expected = Buffer.from(record?.code_hash ?? "", "hex"); const actual = Buffer.from(codeHash(body.phone, body.code), "hex"); const matches = expected.length === actual.length && timingSafeEqual(expected, actual);
          if (!record || record.attempts >= 5 || !matches) { if (record) await connection.execute("UPDATE verification_codes SET attempts = attempts + 1 WHERE id = ?", [record.id]); await connection.commit(); return false; }
          await connection.execute("UPDATE verification_codes SET consumed_at = NOW() WHERE id = ?", [record.id]); await connection.commit(); return true;
        } catch (cause) { await connection.rollback(); throw cause; }
      });
      if (!verified) return error(response, 401, "验证码无效或已过期");
      await audit(session.tenant_id, "account.phone_change.old_verified", request, {}, session.user_id);
      return json(response, 200, { proof: phoneChangeProof(session) });
    }
    if (request.url === "/api/v1/account/phone/verify-new") {
      const session = await sessionFor(request); if (!session) return error(response, 401, "登录已过期，请重新登录");
      if (!validPhone(body.phone) || body.phone === session.phone || !/^\d{6}$/.test(body.code) || !validPhoneChangeProof(body.proof, session)) return error(response, 400, "验证信息无效或已过期，请重新验证原手机号");
      const changed = await withDatabaseLock(lockName("phone", `${session.tenant_id}:${phoneHash(body.phone)}`), async (connection) => {
        await connection.beginTransaction(); try {
          const [users] = await connection.execute("SELECT id FROM users WHERE tenant_id = ? AND phone = ? LIMIT 1 FOR UPDATE", [session.tenant_id, body.phone]); if (users.length) throw new PublicError(409, "该手机号已绑定其他账号");
          const [codes] = await connection.execute("SELECT id, code_hash, attempts FROM verification_codes WHERE tenant_id = ? AND phone = ? AND purpose = 'change_phone' AND consumed_at IS NULL AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1 FOR UPDATE", [session.tenant_id, body.phone]);
          const record = codes[0]; const expected = Buffer.from(record?.code_hash ?? "", "hex"); const actual = Buffer.from(codeHash(body.phone, body.code), "hex"); const matches = expected.length === actual.length && timingSafeEqual(expected, actual);
          if (!record || record.attempts >= 5 || !matches) { if (record) await connection.execute("UPDATE verification_codes SET attempts = attempts + 1 WHERE id = ?", [record.id]); await connection.commit(); return false; }
          await connection.execute("UPDATE verification_codes SET consumed_at = NOW() WHERE id = ?", [record.id]);
          await connection.execute("UPDATE users SET phone = ? WHERE id = ? AND tenant_id = ?", [body.phone, session.user_id, session.tenant_id]);
          await connection.execute("UPDATE sessions SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL", [session.user_id]); await connection.commit(); return true;
        } catch (cause) { await connection.rollback(); throw cause; }
      });
      if (!changed) return error(response, 401, "验证码无效或已过期");
      await audit(session.tenant_id, "account.phone_change.completed", request, { newPhoneHash: phoneHash(body.phone) }, session.user_id);
      response.setHeader("set-cookie", `${config.cookieName}=; Path=/; HttpOnly;${cookieSecure ? " Secure;" : ""} SameSite=Strict; Max-Age=0`);
      return json(response, 200, { changed: true });
    }
    if (request.url === "/api/v1/consultations/history") {
      const session = await sessionFor(request); if (!session) return error(response, 401, "登录已过期，请重新登录");
      return json(response, 200, await consultationHistory(session, body.cursor));
    }
    if (request.url === "/api/v1/consultations/context/clear") {
      const session = await sessionFor(request); if (!session) return error(response, 401, "登录已过期，请重新登录");
      await clearConsultationContext(session);
      await audit(session.tenant_id, "consultation.context.cleared", request, {}, session.user_id);
      return json(response, 200, { cleared: true });
    }
    if (request.url === "/api/v1/consultations/stream") {
      const session = await sessionFor(request); if (!session) return error(response, 401, "登录已过期，请重新登录");
      if (typeof body.message !== "string" || !body.message.trim() || body.message.length > 4000) return error(response, 400, "咨询内容无效");
      const clientRequestId = typeof body.clientRequestId === "string" && /^[A-Za-z0-9-]{20,36}$/.test(body.clientRequestId) ? body.clientRequestId : id();
      const requestStartedAt = performance.now(); const prepared = await prepareConsultation(session, body.message.trim(), clientRequestId);
      beginSse(response);
      if (prepared.duplicate) { sendSse(response, "complete", { ...publicConsultationResult({ suggested_reply: prepared.entry.answer, matched_laws: prepared.entry.matched_laws, matched_cases: prepared.entry.matched_cases }, { businessType: prepared.entry.businessType, entryId: prepared.entry.id }), elapsedMs: Math.round(performance.now() - requestStartedAt) }); return response.end(); }
      try {
        const coreTask = (async () => {
          const prompt = await activePromptFor(session.tenant_id, LAWYER_CORE_PROMPT_KEY);
          const result = await callModel([{ role: "system", content: prompt.content }, { role: "user", content: body.message.trim() }], 0.1, { contextChars: body.message.trim().length });
          return { prompt, result, delivery: validatedDelivery({ response: result.content, taskPlan: {}, toolResults: {}, citations: [] }) };
        })();
        const fullTask = (async () => {
          const [responsePrompt, agentPrompt] = await Promise.all([activePromptFor(session.tenant_id, LAWYER_RESPONSE_PROMPT_KEY), activePromptFor(session.tenant_id, LAWYER_AGENT_PROMPT_KEY)]);
          return { responsePrompt, agentPrompt, agent: await runLegalAgent(body.message.trim(), prepared.caseState, { agent: agentPrompt, response: responsePrompt }) };
        })();
        const core = await coreTask;
        if (core.delivery.validation.pass) sendSse(response, "core_delta", { content: core.delivery.response, elapsedMs: Math.round(performance.now() - requestStartedAt) });
        const full = await fullTask; const delivery = validatedDelivery({ response: full.agent.suggested_reply, taskPlan: full.agent._taskPlan, toolResults: { laws: full.agent.matched_laws, cases: full.agent.matched_cases }, citations: [] });
        full.agent.suggested_reply = delivery.response;
        const stageTimings = { prepare_ms: 0, core_ms: core.result.metrics.model_total_ms, core: core.result.metrics, ...full.agent._stageTimings, validator_ms: Math.round(core.delivery.validation.durationMs + delivery.validation.durationMs) };
        await completeConsultation(prepared, full.agent, full.responsePrompt, stageTimings); stageTimings.total_ms = Math.round(performance.now() - requestStartedAt);
        await db.execute("UPDATE consultation_entries SET stage_timings = ? WHERE id = ?", [JSON.stringify(stageTimings), prepared.entryId]);
        sendSse(response, "answer_delta", { content: delivery.response, matched_laws: full.agent.matched_laws, matched_cases: full.agent.matched_cases });
        sendSse(response, "complete", { entryId: prepared.entryId, matched_laws: full.agent.matched_laws, matched_cases: full.agent.matched_cases, elapsedMs: stageTimings.total_ms });
        await audit(session.tenant_id, "consultation.answer.generated", request, { consultationEntryId: prepared.entryId, agentPromptVersion: full.agentPrompt.version, responsePromptVersion: full.responsePrompt.version, corePromptVersion: core.prompt.version }, session.user_id);
        return response.end();
      } catch (cause) { await failConsultation(prepared.entryId); await recordServiceError(cause, "consultation_stream", requestId, session, "CONSULTATION_FAILED"); sendSse(response, "error", { message: "服务暂时不可用" }); return response.end(); }
    }
    if (request.url === "/api/v1/consultations/messages") {
      const session = await sessionFor(request); if (!session) return error(response, 401, "登录已过期，请重新登录");
      if (typeof body.message !== "string" || !body.message.trim() || body.message.length > 4000) return error(response, 400, "咨询内容无效");
      const clientRequestId = typeof body.clientRequestId === "string" && /^[A-Za-z0-9-]{20,36}$/.test(body.clientRequestId) ? body.clientRequestId : id();
      const requestStartedAt = performance.now();
      const prepareStartedAt = performance.now();
      const prepared = await prepareConsultation(session, body.message.trim(), clientRequestId);
      const prepareDurationMs = Math.round(performance.now() - prepareStartedAt);
      if (prepared.duplicate) return json(response, 200, { answer: prepared.entry.answer, matched_laws: prepared.entry.matched_laws, matched_cases: prepared.entry.matched_cases, businessType: prepared.entry.businessType, entryId: prepared.entry.id, duplicate: true });
      try {
        const responsePrompt = await activePromptFor(session.tenant_id, LAWYER_RESPONSE_PROMPT_KEY);
        const agentPrompt = await activePromptFor(session.tenant_id, LAWYER_AGENT_PROMPT_KEY);
        const agent = await runLegalAgent(body.message.trim(), prepared.caseState, { agent: agentPrompt, response: responsePrompt });
        for (const failure of agent._toolFailures ?? []) await recordServiceError(failure.error, failure.component, requestId, session, "LEGAL_TOOL_DEGRADED");
        const delivery = validatedDelivery({ response: agent.suggested_reply, taskPlan: agent._taskPlan, toolResults: { laws: agent.matched_laws, cases: agent.matched_cases }, citations: [] });
        const stageTimings = { prepare_ms: prepareDurationMs, ...agent._stageTimings, validator_ms: Math.round(delivery.validation.durationMs) };
        if (!delivery.validation.pass) await recordServiceError(new Error(JSON.stringify({ conversationId: prepared.contextId, issues: delivery.validation.issues.map(({ code, severity, rule }) => ({ code, severity, rule })), validatorDurationMs: delivery.validation.durationMs, agentPromptVersion: agentPrompt.version, responsePromptVersion: responsePrompt.version })), "response_validator", requestId, session, "RESPONSE_VALIDATION_FAILED");
        agent.suggested_reply = delivery.response;
        const persistenceStartedAt = performance.now();
        await completeConsultation(prepared, agent, responsePrompt, stageTimings);
        stageTimings.persistence_ms = Math.round(performance.now() - persistenceStartedAt);
        stageTimings.total_ms = Math.round(performance.now() - requestStartedAt);
        await db.execute("UPDATE consultation_entries SET stage_timings = ? WHERE id = ?", [JSON.stringify(stageTimings), prepared.entryId]);
        console.info("[PERF]", JSON.stringify({ request_id: requestId, route: agent.route.toUpperCase(), total_ms: stageTimings.total_ms, v2a: stageTimings.v2a, tools: stageTimings.tools, v2b: stageTimings.v2b, validator_ms: stageTimings.validator_ms, persist_ms: stageTimings.persistence_ms }));
        await audit(session.tenant_id, "consultation.answer.generated", request, { consultationEntryId: prepared.entryId, businessType: prepared.classification.businessType, agentPromptVersion: agentPrompt.version, responsePromptVersion: responsePrompt.version }, session.user_id);
        return json(response, 200, publicConsultationResult(agent, { businessType: prepared.classification.businessType, entryId: prepared.entryId }));
      } catch (cause) {
        await failConsultation(prepared.entryId);
        await recordServiceError(cause, "consultation", requestId, session, "CONSULTATION_FAILED");
        throw cause;
      }
    }
    return error(response, 404, "接口不存在");
  } catch (exception) {
    console.error("API request failed", safeErrorMessage(exception));
    if (!(exception instanceof PublicError)) await recordServiceError(exception, "api", requestId);
    return error(response, exception instanceof PublicError ? exception.status : 500, exception instanceof PublicError ? exception.message : "服务暂时不可用");
  }
});
await db.execute("SELECT 1");
await purgeExpiredInternalData().catch((exception) => console.error("Internal log cleanup failed", safeErrorMessage(exception)));
const cleanupTimer = setInterval(() => purgeExpiredInternalData().catch((exception) => console.error("Internal log cleanup failed", safeErrorMessage(exception))), 24 * 60 * 60_000);
cleanupTimer.unref();
server.listen(config.port, "127.0.0.1", () => console.log(`Pocket Legal API listening on 127.0.0.1:${config.port}`));
async function shutdown(signal) {
  console.log(`Received ${signal}; shutting down API.`);
  clearInterval(cleanupTimer);
  server.close(async () => { await db.end(); process.exit(0); });
}
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
