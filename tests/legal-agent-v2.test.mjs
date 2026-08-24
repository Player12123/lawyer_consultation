import assert from "node:assert/strict";
import test from "node:test";

import { LAWYER_AGENT_PROMPT_KEY, LAWYER_RESPONSE_PROMPT_KEY, LAWYER_RESPONSE_PROMPT, compactCaseFacts, compactTaskPlan, compactToolResults, createFallbackTaskPlan, normalizeTaskPlan, publicConsultationResult, selectToolsForTaskPlan } from "../backend/legal-agent-v2.mjs";

test("formal prompt keys are versionless and identify their distinct responsibilities", () => {
  assert.equal(LAWYER_AGENT_PROMPT_KEY, "lawyer_agent");
  assert.equal(LAWYER_RESPONSE_PROMPT_KEY, "lawyer_response");
});

test("V2 agent keeps multiple explicit lawyer questions and routes only requested tools", () => {
  const fallback = createFallbackTaskPlan("房东提前收回商铺，我能要求继续履行吗？装修费能不能赔？给我类似案例和法条。", {});
  const plan = normalizeTaskPlan({
    ...fallback,
    task_types: ["CASE_ANALYSIS", "LAW", "CASE_SEARCH"],
    user_questions: ["能否要求继续履行", "装修费能否赔偿", "是否有类似案例和法条"],
    tools: ["law_search", "case_search", "unknown_tool"],
    answer_depth: "DEEP",
  }, fallback);

  assert.deepEqual(plan.user_questions, ["能否要求继续履行", "装修费能否赔偿", "是否有类似案例和法条"]);
  assert.deepEqual(selectToolsForTaskPlan(plan, { law_search: true, case_search: true }), ["law_search", "case_search"]);
  assert.equal(plan.answer_depth, "DEEP");
});

test("V2 agent treats an asserted legal conclusion as unconfirmed and chooses one key follow-up", () => {
  const fallback = createFallbackTaskPlan("公司违法解除我，能拿2N吗？", {});

  assert.equal(fallback.information_status, "KEY_FACT_MISSING");
  assert.match(fallback.key_fact_gap, /解除/);
  assert.equal(fallback.user_legal_evaluations.includes("违法解除"), true);
  assert.equal(fallback.confirmed_facts.includes("公司违法解除我"), false);
});

test("only lawyer-visible answer and references cross the API boundary", () => {
  const result = publicConsultationResult({
    suggested_reply: "建议先核对解除通知及送达证据。",
    matched_laws: [{ name: "劳动合同法", article: "第48条", text: "用人单位违法解除..." }],
    matched_cases: [],
    case_state: { missing_facts: ["解除理由"] },
    _taskPlan: { task_types: ["LAW"], information_status: "KEY_FACT_MISSING" },
  }, { businessType: "劳动争议", entryId: "entry-1" });

  assert.deepEqual(result, {
    answer: "建议先核对解除通知及送达证据。",
    matched_laws: [{ name: "劳动合同法", article: "第48条", text: "用人单位违法解除..." }],
    matched_cases: [],
    businessType: "劳动争议",
    entryId: "entry-1",
  });
});

test("compact V2 handoff retains only the planner contract and necessary facts", () => {
  const compactPlan = compactTaskPlan({
    user_questions: ["能否主张2N", "重点看哪些证据"],
    confirmed_facts: ["工作3年", "月薪1万元", "无书面解除通知"],
    key_fact_gap: "公司是否已明确解除劳动关系及具体理由",
    tools: ["law_search"],
    answer_depth: "STANDARD",
    legal_analysis_focus: ["劳动合同解除条件"],
    case_state_patch: { user_goal: "不应出现在任务包中" },
  });
  const facts = compactCaseFacts({
    user_goal: "劳动争议咨询",
    legal_issues: ["解除是否合法", "补偿标准"],
    known_facts: ["工作3年", "月薪1万元", "公司口头称表现不好"],
    confirmed_facts: ["无书面解除通知"],
    uncertain_facts: ["违法解除"],
    missing_facts: ["解除理由"],
    evidence: ["劳动合同"],
    laws_used: [{ very: "large raw payload" }],
    cases_used: [{ very: "large raw payload" }],
  });

  assert.deepEqual(compactPlan, {
    questions: ["能否主张2N", "重点看哪些证据"],
    key_facts: ["工作3年", "月薪1万元", "无书面解除通知"],
    critical_missing_fact: "公司是否已明确解除劳动关系及具体理由",
    need_tools: ["law"],
    depth: "STANDARD",
    core_issues: ["劳动合同解除条件"],
  });
  assert.deepEqual(facts, {
    goal: "劳动争议咨询",
    issues: ["解除是否合法", "补偿标准"],
    known_facts: ["工作3年", "月薪1万元", "公司口头称表现不好", "无书面解除通知"],
    uncertain_facts: ["违法解除"],
    missing_facts: ["解除理由"],
    evidence: ["劳动合同"],
  });
});

test("strong tool trigger ignores planner hints unless the lawyer explicitly asks", () => {
  const plan = { tools: ["law_search", "case_search"] };

  assert.deepEqual(selectToolsForTaskPlan(plan, { law_search: true, case_search: true }, { law_search: false, case_search: false }), []);
  assert.deepEqual(selectToolsForTaskPlan(plan, { law_search: true, case_search: true }, { law_search: true, case_search: false }), ["law_search"]);
  assert.deepEqual(selectToolsForTaskPlan(plan, { law_search: true, case_search: true }, { law_search: false, case_search: true }), ["case_search"]);
});

test("explicit request for similar cases is planned as a case-search request", () => {
  const plan = createFallbackTaskPlan("帮我找类似案件，看看法院通常怎么处理。", {});

  assert.equal(plan.tools.includes("case_search"), true);
});

test("explicit requests for legal provisions and clauses are planned as a law search", () => {
  const plan = createFallbackTaskPlan("公司以业绩不达标解除劳动合同，具体涉及哪些法律规定和条款？", {});

  assert.equal(plan.tools.includes("law_search"), true);
});

test("responder receives citation-ready tool excerpts instead of raw tool payloads", () => {
  const results = compactToolResults({
    laws: [{ id: "law-1", name: "劳动合同法", article: "第四十条", text: "用人单位提前三十日以书面形式通知劳动者本人或者额外支付劳动者一个月工资后，可以解除劳动合同。".repeat(20), region: "全国", score: 0.9 }],
    cases: [{ id: "case-1", fact_summary: "劳动者不能胜任工作", assessment_conclusion: "应先培训或者调岗", assessment_reasoning: "不应出现在压缩包", action_strategy: "不应出现在压缩包", action_steps: ["不应出现在压缩包"], risk_notes: "不应出现在压缩包", law_refs: ["劳动合同法第四十条"] }],
  });

  assert.equal(results.laws[0].id, "law-1");
  assert.equal(results.laws[0].text.length, 600);
  assert.deepEqual(results.cases, [{ id: "case-1", fact_summary: "劳动者不能胜任工作", conclusion: "应先培训或者调岗", law_refs: ["劳动合同法第四十条"] }]);
  assert.equal(JSON.stringify(results).includes("assessment_reasoning"), false);
  assert.equal(JSON.stringify(results).includes("action_strategy"), false);
});

test("STANDARD responder prompt requires legal density without restoring full context", () => {
  assert.match(LAWYER_RESPONSE_PROMPT, /结论.*关键法律判断.*事实对应.*处理建议/);
  assert.match(LAWYER_RESPONSE_PROMPT, /STANDARD/);
  assert.match(LAWYER_RESPONSE_PROMPT, /不得重新扩展案情|不得.*完整历史/);
  assert.match(LAWYER_RESPONSE_PROMPT, /处理建议/);
  assert.match(LAWYER_RESPONSE_PROMPT, /TOOL_RESULTS/);
  assert.match(LAWYER_RESPONSE_PROMPT, /不得复制法条全文/);
});

test("responder prompt leads with a conclusion and avoids conversational filler", () => {
  assert.match(LAWYER_RESPONSE_PROMPT, /结论优先/);
  assert.match(LAWYER_RESPONSE_PROMPT, /最关键的法律理由/);
  assert.match(LAWYER_RESPONSE_PROMPT, /不要使用“好的，我明白了”/);
  assert.match(LAWYER_RESPONSE_PROMPT, /简要写明法律名称和条款号/);
  assert.match(LAWYER_RESPONSE_PROMPT, /分段|空行/);
});

test("default responder answer keeps legal conditions and next steps instead of only shortening", () => {
  assert.match(LAWYER_RESPONSE_PROMPT, /结论.*关键法律判断.*事实对应.*处理建议/);
  assert.match(LAWYER_RESPONSE_PROMPT, /只有纯事实查询/);
  assert.match(LAWYER_RESPONSE_PROMPT, /不得为了缩短回复而省略/);
});

test("responder turns available law and case results into the main legal analysis", () => {
  assert.match(LAWYER_RESPONSE_PROMPT, /TOOL_RESULTS.*有效法条或类案/);
  assert.match(LAWYER_RESPONSE_PROMPT, /结论.*关键法律判断.*事实对应.*处理建议/);
  assert.match(LAWYER_RESPONSE_PROMPT, /而不是只把专业信息留在下方卡片/);
  assert.match(LAWYER_RESPONSE_PROMPT, /额外工具或模型调用/);
  assert.match(LAWYER_RESPONSE_PROMPT, /法条和类案均有有效结果.*各吸收一项/);
});
