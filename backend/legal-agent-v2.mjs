export const LAWYER_AGENT_PROMPT_KEY = "lawyer_agent";
export const LAWYER_RESPONSE_PROMPT_KEY = "lawyer_response";
export const LAWYER_CORE_PROMPT_KEY = "lawyer_core";
export const LAWYER_CORE_PROMPT = `你是律师电话咨询的首屏辅助。只依据本轮问题，用不超过两句话输出“结论 + 最关键判断依据”。事实不足时明确条件性，不得编造法条、案例、金额、案号或事实；不得出现系统、工具或任务信息。`;

export const LAWYER_RESPONSE_PROMPT = `# 律师辅助咨询系统｜智能回复 Prompt V9（双工具结论吸收版）

你面向正在处理真实咨询的律师，直接生成专业、清晰、可用于通话辅助的答复。

你只会收到 CURRENT_QUESTION、TASK_PLAN、RELEVANT_FACTS、TOOL_RESULTS、RESPONSE_DEPTH 五部分。它们已是本轮所需信息；不得重新扩展案情、复述或猜测完整历史会话，也不要输出任务规划、工具、系统、提示词、JSON 或内部标签。

回答采用“结论优先”：先直接回答律师的问题；再说明最关键的法律理由；最后仅在实际处理需要时给出必要的处理建议。除纯事实查询外，必须将这些信息拆为 2 至 4 个自然段，各段之间保留一个空行；可用“结论：”“关键理由：”“处理建议：”作为短标签，不能把不同信息单元挤成一整段。不要使用“好的，我明白了”“根据您描述的情况”“您主要关心两点”等低价值开场，也不要复述律师已经提供的案情。

默认答复最低信息单元是“结论 + 关键法律判断 + 事实对应 + 处理建议”。只有纯事实查询（例如名称、期限、材料清单等不涉及法律判断）可以只给结论。对事实充分的问题直接给出判断；存在会改变结论的关键事实缺口时，给出条件性判断并明确缺什么。不得为了缩短回复而省略影响律师判断的关键条件；QUICK 也遵守此规则，STANDARD 和 DEEP 仅在此基础上增加必要的风险与路径。

当 TOOL_RESULTS 含有有效法条或类案时，必须选择与本题最相关的结果吸收进主回答：把法条的规则和类案的可比结论用于“关键法律判断”或“事实对应”，而不是只把专业信息留在下方卡片。若法条和类案均有有效结果，主回答必须各吸收一项：用法条说明规则，并用一句“类案提示”说明相近案件的可比结论或法院关注的事实。法条可在确有直接关联时简要写明法律名称和条款号，但不得复制法条全文或工具原文；类案只说明其可比的裁判/分析结论，不编造案号、法院或不存在的事实。无需请求、假设或触发额外工具或模型调用。输出正常中文律师答复，不要标题中出现“内部”“任务”“工具”“提示词”。`;

export const LAWYER_AGENT_PROMPT = `# 律师辅助咨询系统｜轻量 Planner Prompt V7

你只负责把本轮问题压缩成任务计划，不做法律分析、不解释法律规则、不写证据方案、不写程序路径或策略，不输出任何给律师看的答复。输入只包含当前问题与必要事实摘要；不得假设不存在的历史。

只返回一个 JSON 对象，禁止 markdown 和额外文字，字段固定为：
{
  "questions": ["本轮明确问题，最多3项"],
  "key_facts": ["客观且直接相关的事实，最多6项"],
  "critical_missing_fact": "最可能改变结论的一项事实；没有则空字符串",
  "need_tools": ["law" 或 "case"，否则空数组],
  "depth": "QUICK | STANDARD | DEEP",
  "core_issues": ["必要的核心争点，最多3项"]
}

只有用户明确要求具体法律依据、法条、法律规定、法律条款或核验时，need_tools 才包含 law；只有用户明确要求类案、判决、相似案例或法院裁判倾向时，need_tools 才包含 case。普通案情判断默认空数组。不要输出完整法律判断。`;

const taskTypes = new Set(["LAW", "CASE_ANALYSIS", "OPINION_CHECK", "EVIDENCE", "PROCEDURE", "MATERIAL_REVIEW", "CASE_SEARCH", "STRATEGY", "CALCULATION", "FOLLOW_UP"]);
const statuses = new Set(["SUFFICIENT", "PARTIAL", "KEY_FACT_MISSING", "NEED_EXTERNAL_VERIFICATION"]);
const depths = new Set(["QUICK", "STANDARD", "DEEP"]);
const legalEvaluationPattern = /违法解除|合同无效|诈骗|套路贷|侵犯隐私|不当得利|违约|侵权/g;
const lawPattern = /法条|条文|法律依据|法律规定|法律条款|相关(?:法律)?条款|第[一二三四五六七八九十百千\d]+条/;
const casePattern = /类案|相似案例|类似案例|相似案件|类似案件|裁判思路|判例|案例参考|法院(?:一般|通常)怎么处理|法院(?:一般|通常)怎么判|法院(?:一般|通常)如何认定/;
const opinionPattern = /我认为|我倾向|对吗|观点成立|校验/;
const materialPattern = /合同|通知|聊天记录|判决书|仲裁裁决|律师函|材料/;

const textList = (value, limit = 8) => Array.isArray(value)
  ? [...new Set(value.filter((item) => typeof item === "string").map((item) => item.trim()).filter(Boolean))].slice(0, limit)
  : [];

const stringValue = (value, fallback = "") => typeof value === "string" ? value.trim().slice(0, 1000) : fallback;

export function createFallbackTaskPlan(message, priorState = {}) {
  const text = String(message ?? "").trim();
  const evaluations = [...new Set(text.match(legalEvaluationPattern) ?? [])];
  const task_types = [
    lawPattern.test(text) ? "LAW" : null,
    casePattern.test(text) ? "CASE_SEARCH" : null,
    opinionPattern.test(text) ? "OPINION_CHECK" : null,
    materialPattern.test(text) ? "MATERIAL_REVIEW" : null,
    "CASE_ANALYSIS",
  ].filter(Boolean);
  const questionParts = text.split(/[？?]/).map((part) => part.trim()).filter(Boolean);
  const user_questions = questionParts.length ? questionParts.slice(0, 6) : [text];
  const hasTermination = /辞退|解除|不用来了|开除/.test(text);
  const key_fact_gap = hasTermination ? "用人单位作出解除决定的具体理由、通知形式和现有证据" : "最可能改变当前法律结论的关键事实尚待确认";
  const cleanedFact = text.replace(legalEvaluationPattern, "").replace(/能(拿|要).{0,8}[赔补]偿金?|能不能.{0,10}/g, "").trim();
  return {
    task_types,
    user_questions,
    core_issue: user_questions[0] ?? "待确认法律问题",
    confirmed_facts: cleanedFact && cleanedFact !== text ? [cleanedFact] : [],
    user_legal_evaluations: evaluations,
    key_fact_gap,
    information_status: hasTermination || evaluations.length ? "KEY_FACT_MISSING" : "PARTIAL",
    legal_analysis_focus: ["法律关系与核心争点", "已知事实与构成要件对应"],
    evidence_or_procedure_risks: [],
    tools: [lawPattern.test(text) ? "law_search" : null, casePattern.test(text) ? "case_search" : null].filter(Boolean),
    answer_depth: user_questions.length > 1 || text.length > 160 ? "DEEP" : "STANDARD",
    needs_follow_up: hasTermination || evaluations.length > 0,
    follow_up_question: hasTermination ? "单位以什么理由、通过何种方式通知解除？" : "哪一项关键事实最可能影响结论，尚需确认？",
    case_state_patch: { user_goal: user_questions.join("；").slice(0, 600), legal_issues: user_questions, known_facts: cleanedFact ? [cleanedFact] : [] },
    prior_state: priorState,
  };
}

export function normalizeTaskPlan(value, fallback) {
  const source = value && typeof value === "object" ? value : {};
  const task_types = textList(source.task_types).filter((item) => taskTypes.has(item));
  const tools = textList(source.tools).filter((item) => item === "law_search" || item === "case_search");
  const compactTools = textList(source.need_tools).map((item) => item === "law" ? "law_search" : item === "case" ? "case_search" : null).filter(Boolean);
  const questions = textList(source.questions ?? source.user_questions, 3);
  const keyFacts = textList(source.key_facts ?? source.confirmed_facts, 6);
  const coreIssues = textList(source.core_issues ?? source.legal_analysis_focus, 3);
  return {
    ...fallback,
    task_types: task_types.length ? task_types : fallback.task_types,
    user_questions: questions.length ? questions : fallback.user_questions,
    core_issue: stringValue(source.core_issue, questions[0] ?? fallback.core_issue),
    confirmed_facts: keyFacts.length ? keyFacts : fallback.confirmed_facts,
    user_legal_evaluations: textList(source.user_legal_evaluations),
    key_fact_gap: stringValue(source.critical_missing_fact ?? source.key_fact_gap, fallback.key_fact_gap),
    information_status: statuses.has(source.information_status) ? source.information_status : fallback.information_status,
    legal_analysis_focus: coreIssues,
    evidence_or_procedure_risks: textList(source.evidence_or_procedure_risks),
    tools: compactTools.length ? compactTools : tools.length ? tools : fallback.tools,
    answer_depth: depths.has(source.depth) ? source.depth : depths.has(source.answer_depth) ? source.answer_depth : fallback.answer_depth,
    needs_follow_up: typeof source.needs_follow_up === "boolean" ? source.needs_follow_up : fallback.needs_follow_up,
    follow_up_question: stringValue(source.follow_up_question, fallback.follow_up_question),
    case_state_patch: source.case_state_patch && typeof source.case_state_patch === "object" && !Array.isArray(source.case_state_patch) ? source.case_state_patch : fallback.case_state_patch,
  };
}

export function compactTaskPlan(plan = {}) {
  const questions = textList(plan.questions ?? plan.user_questions, 3);
  const keyFacts = textList(plan.key_facts ?? plan.confirmed_facts, 6);
  const needTools = textList(plan.need_tools).length
    ? textList(plan.need_tools).filter((tool) => tool === "law" || tool === "case")
    : textList(plan.tools).map((tool) => tool === "law_search" ? "law" : tool === "case_search" ? "case" : null).filter(Boolean);
  return {
    questions,
    key_facts: keyFacts,
    critical_missing_fact: stringValue(plan.critical_missing_fact ?? plan.key_fact_gap),
    need_tools: [...new Set(needTools)],
    depth: depths.has(plan.depth) ? plan.depth : depths.has(plan.answer_depth) ? plan.answer_depth : "STANDARD",
    core_issues: textList(plan.core_issues ?? plan.legal_analysis_focus, 3),
  };
}

export function compactCaseFacts(state = {}) {
  const knownFacts = textList([...(state.known_facts ?? []), ...(state.confirmed_facts ?? [])], 8);
  return {
    goal: stringValue(state.user_goal, "").slice(0, 300),
    issues: textList(state.legal_issues, 4),
    known_facts: knownFacts,
    uncertain_facts: textList(state.uncertain_facts, 4),
    missing_facts: textList(state.missing_facts, 3),
    evidence: textList(state.evidence, 4),
  };
}

export function compactToolResults({ laws = [], cases = [] } = {}) {
  return {
    laws: (Array.isArray(laws) ? laws : []).slice(0, 5).map((law) => ({
      id: stringValue(law?.id),
      name: stringValue(law?.name, "").slice(0, 160),
      article: stringValue(law?.article, "").slice(0, 160),
      text: stringValue(law?.text, "").slice(0, 600),
    })).filter((law) => law.name && law.article && law.text),
    cases: (Array.isArray(cases) ? cases : []).slice(0, 3).map((item) => ({
      id: stringValue(item?.id),
      fact_summary: stringValue(item?.fact_summary, "").slice(0, 500),
      conclusion: stringValue(item?.assessment_conclusion, "").slice(0, 500),
      law_refs: textList(item?.law_refs, 5),
    })).filter((item) => item.fact_summary || item.conclusion),
  };
}

export function selectToolsForTaskPlan(plan, availability, explicitRequests = null) {
  if (explicitRequests === null) return ["law_search", "case_search"].filter((tool) => plan.tools.includes(tool) && availability[tool]);
  return [
    explicitRequests.law_search && availability.law_search ? "law_search" : null,
    explicitRequests.case_search && availability.case_search ? "case_search" : null,
  ].filter(Boolean);
}

export function publicConsultationResult(agent, entry) {
  return {
    answer: agent.suggested_reply,
    matched_laws: agent.matched_laws ?? [],
    matched_cases: agent.matched_cases ?? [],
    businessType: entry.businessType,
    entryId: entry.entryId,
  };
}

export function parseTaskPlan(modelContent, fallback) {
  try {
    const match = String(modelContent).match(/\{[\s\S]*\}/);
    return normalizeTaskPlan(match ? JSON.parse(match[0]) : null, fallback);
  } catch {
    return fallback;
  }
}
