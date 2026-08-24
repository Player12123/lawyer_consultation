import dotenv from "dotenv";
import mysql from "mysql2/promise";

import { compactToolResults } from "../backend/legal-agent-v2.mjs";

dotenv.config({ path: process.env.ENV_FILE ?? ".env.local" });

const entryId = process.env.AB_ENTRY_ID ?? "f75adf35a2099c78669480abbc";
const question = "公司以“不能胜任工作”为由解除一名工作 3 年、月薪 1 万元的员工，但此前仅有两个月绩效不达标记录，未安排培训、未调岗，也未书面通知解除。请分析公司解除是否合法；给出直接相关法律条款；并查找类似案件，说明法院通常关注哪些事实、员工可主张哪些赔偿及应保留哪些证据。";

if (!process.env.DATABASE_URL || !process.env.AI_BASE_URL || !process.env.AI_API_KEY || !process.env.AI_MODEL) throw new Error("AB 测试所需配置不完整");

const db = await mysql.createConnection({ uri: process.env.DATABASE_URL });

async function activePrompt(version) {
  const [rows] = await db.execute("SELECT content FROM prompt_versions WHERE tenant_id = ? AND prompt_key = 'lawyer_response' AND version = ? LIMIT 1", [process.env.TENANT_ID, version]);
  if (!rows[0]?.content) throw new Error(`未找到回复提示词版本 ${version}`);
  return rows[0].content;
}

async function modelCall(prompt, responderContext) {
  const messages = [{ role: "system", content: prompt }, { role: "user", content: JSON.stringify(responderContext) }];
  const startedAt = performance.now();
  const response = await fetch(`${process.env.AI_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.AI_API_KEY}` },
    body: JSON.stringify({ model: process.env.AI_MODEL, temperature: Number(process.env.AI_TEMPERATURE ?? 0.2), stream: false, messages, ...(process.env.AI_THINKING_TYPE ? { thinking: { type: process.env.AI_THINKING_TYPE } } : {}) }),
    signal: AbortSignal.timeout(Number(process.env.AI_TIMEOUT_MS ?? 30_000)),
  });
  if (!response.ok) throw new Error(`模型 AB 调用失败：${response.status}`);
  const body = await response.json();
  const answer = String(body.choices?.[0]?.message?.content ?? "").trim();
  return { answer, elapsed_ms: Math.round(performance.now() - startedAt), output_chars: answer.length, usage: body.usage ?? null, finish_reason: body.choices?.[0]?.finish_reason ?? null };
}

function jsonArray(value) {
  if (Array.isArray(value)) return value;
  try { return JSON.parse(String(value ?? "[]")); } catch { return []; }
}

try {
  const [[entryRows]] = await Promise.all([
    db.execute("SELECT matched_laws, matched_cases FROM consultation_entries WHERE id = ? LIMIT 1", [entryId]),
  ]);
  const entry = entryRows[0];
  if (!entry) throw new Error("未找到指定 AB 样本");
  const tools = compactToolResults({ laws: jsonArray(entry.matched_laws), cases: jsonArray(entry.matched_cases) });
  const responderContext = {
    CURRENT_QUESTION: question,
    TASK_PLAN: { questions: ["解除是否合法", "直接相关法律条款", "类案关注事实、赔偿与证据"], key_facts: ["工作3年", "月薪1万元", "两个月绩效不达标", "未培训", "未调岗", "未书面通知解除"], critical_missing_fact: "单位是否能证明员工不能胜任工作，以及解除理由和通知证据", need_tools: ["law", "case"], depth: "DEEP", core_issues: ["不能胜任工作的解除条件", "违法解除责任"] },
    RELEVANT_FACTS: { goal: "判断劳动合同解除合法性", issues: ["解除是否合法", "赔偿与证据"], known_facts: ["工作3年", "月薪1万元", "两个月绩效不达标", "未培训、未调岗、未书面通知解除"], uncertain_facts: [], missing_facts: ["解除理由和通知证据"], evidence: [] },
    TOOL_RESULTS: tools,
    RESPONSE_DEPTH: "DEEP",
  };
  const [v8Prompt, v9Prompt] = await Promise.all([activePrompt(8), activePrompt(9)]);
  const v8 = await modelCall(v8Prompt, responderContext);
  const v9 = await modelCall(v9Prompt, responderContext);
  console.log(JSON.stringify({ entry_id: entryId, question, fixed_context_chars: JSON.stringify(responderContext).length, tool_counts: { laws: tools.laws.length, cases: tools.cases.length }, v8, v9 }, null, 2));
} finally {
  await db.end();
}
