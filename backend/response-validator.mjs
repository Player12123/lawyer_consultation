export const LAWYER_RESPONSE_VALIDATOR_V2 = {
  enabled: true,
  maxCharacters: 16_000,
  internalProductNames: ["口袋智能律师", "Pocket Legal Assistant", "Pocket Legal"],
};

const internalLabelPatterns = [
  /\b(?:LAW|CASE_ANALYSIS|OPINION_CHECK|EVIDENCE|PROCEDURE|MATERIAL_REVIEW|CASE_SEARCH|STRATEGY|CALCULATION|FOLLOW_UP|SUFFICIENT|PARTIAL|KEY_FACT_MISSING|NEED_EXTERNAL_VERIFICATION|QUICK|STANDARD|DEEP)\s*(?:类型|任务|标签|模式|task|label|mode|:|：)/i,
  /["']?(?:task_type|task_types|response_depth|answer_depth|information_status)["']?\s*[:：]/i,
];
const internalSystemPatterns = [/System Prompt/i, /系统提示词|根据系统要求|根据上游智能体|我的内部任务|工具调用计划|内部分析|任务计划|Prompt规则|我应该这样回答|以下是答复策略/];
const structuredTaskFields = [/当前任务[：:]/, /用户明确问题[：:]/, /核心争点[：:]/, /关键事实缺口[：:]/, /推荐回答深度[：:]/];
const toolErrorPattern = /(?:ECONNREFUSED|ETIMEDOUT|ENOTFOUND|500\s+Internal Server Error|stack trace|\bError\s*:|\bException\s*:|at\s+\S+\s*\([^)]*:\d+:\d+\))/i;
const meaninglessReplies = new Set(["好", "好的", "可以", "是的", "嗯", "收到", "ok", "okay"]);

function issue(code, severity, message, rule) {
  return { code, severity, message, rule };
}

function normalizeResponse(response) {
  return String(response ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isRawStructuredOutput(text) {
  return (/^\s*\{[\s\S]*\}\s*$/.test(text) && /["'](?:task|answer|response|content|tool|debug)/i.test(text))
    || /<(?:tool_call|invoke|function_call|observation|debug)\b/i.test(text)
    || /^\s*<\?xml/i.test(text);
}

function validCitationIds(toolResults = {}) {
  const ids = { law: new Set(), case: new Set(), document: new Set() };
  for (const law of toolResults.laws ?? []) if (law?.id) ids.law.add(String(law.id));
  for (const caseItem of toolResults.cases ?? []) if (caseItem?.id) ids.case.add(String(caseItem.id));
  for (const document of toolResults.documents ?? []) if (document?.id) ids.document.add(String(document.id));
  return ids;
}

export function validateLawyerResponse({ response, taskPlan = {}, toolResults = {}, citations = [], config = LAWYER_RESPONSE_VALIDATOR_V2 }) {
  const startedAt = performance.now();
  const text = normalizeResponse(response);
  const issues = [];
  if (!text) issues.push(issue("EMPTY_RESPONSE", "high", "回复为空", "empty_response"));
  if (text && (meaninglessReplies.has(text.toLowerCase()) || (text.length <= 3 && !/[。；，、】【]/.test(text)))) issues.push(issue("MEANINGLESS_RESPONSE", "high", "回复缺少可用法律信息", "meaningless_response"));
  if (text.length > config.maxCharacters) issues.push(issue("ABNORMAL_RESPONSE_LENGTH", "high", "回复长度超过安全上限", "max_characters"));
  if (internalLabelPatterns.some((pattern) => pattern.test(text))) issues.push(issue("INTERNAL_LABEL_LEAK", "high", "发现内部任务标签或模式字段", "internal_label"));
  if (internalSystemPatterns.some((pattern) => pattern.test(text))) issues.push(issue("INTERNAL_SYSTEM_INFO_LEAK", "high", "发现内部系统或提示词信息", "internal_system_info"));
  if (config.internalProductNames.some((name) => text.includes(name))) issues.push(issue("INTERNAL_PRODUCT_NAME_LEAK", "high", "发现内部项目或产品名称", "internal_product_name"));
  if (structuredTaskFields.filter((pattern) => pattern.test(text)).length >= 2) issues.push(issue("TASK_PLAN_LEAK", "high", "发现结构化任务结果字段", "task_plan_fields"));
  if (isRawStructuredOutput(text)) issues.push(issue("RAW_STRUCTURED_OUTPUT", "high", "发现原始 JSON、XML 或工具调用内容", "raw_structured_output"));
  if (toolErrorPattern.test(text)) issues.push(issue("TOOL_ERROR_LEAK", "high", "发现原始系统或工具错误", "tool_error"));

  const ids = validCitationIds(toolResults);
  const invalidCitation = Array.isArray(citations) && citations.some((citation) => citation && typeof citation === "object" && typeof citation.sourceId === "string" && !ids[citation.type]?.has(citation.sourceId));
  if (invalidCitation) issues.push(issue("INVALID_CITATION", "high", "发现未来自本轮工具结果的引用", "citation_source"));

  return { pass: issues.length === 0, response: text, issues, durationMs: performance.now() - startedAt, taskPlanUsed: Boolean(taskPlan) };
}

export function validatedDelivery(input) {
  const validation = validateLawyerResponse(input);
  return { response: validation.pass ? validation.response : "当前回复生成异常，请稍后重试。", validation };
}
