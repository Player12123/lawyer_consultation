"use client";

import { useState } from "react";

type LegalReference = { name: string; article: string; text: string; region?: string; score?: number };
type CaseReference = { keyword?: string; fact_summary: string; assessment_conclusion?: string; law_refs?: string[]; score?: number };
type Message = { role: "user" | "assistant"; content: string; laws?: LegalReference[]; cases?: CaseReference[] };
type AgentResult = { answer: string; message?: string; action?: string; case_state?: Record<string, unknown>; legal_issue?: string; suggested_question?: string; matched_laws?: LegalReference[]; matched_cases?: CaseReference[] };

export default function ConsultationLab() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [caseState, setCaseState] = useState<Record<string, unknown>>({});

  async function submit() {
    const message = input.trim();
    if (!message || loading) return;
    const history = messages.map(({ role, content }) => ({ role, content }));
    setMessages((current) => [...current, { role: "user", content: message }]);
    setInput(""); setLoading(true);
    try {
      const response = await fetch("/api/v1/consultations/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, history, caseState }) });
      const result = await response.json().catch(() => ({})) as AgentResult;
      if (!response.ok) throw new Error(result.message || "测试服务暂时不可用");
      if (result.case_state) setCaseState(result.case_state);
      setMessages((current) => [...current, { role: "assistant", content: result.answer, laws: result.matched_laws, cases: result.matched_cases }]);
    } catch (error) {
      setMessages((current) => [...current, { role: "assistant", content: error instanceof Error ? error.message : "测试服务暂时不可用" }]);
    } finally { setLoading(false); }
  }

  return <main className="labPage">
    <header className="labHeader"><div><p>本机测试入口 · 单智能体案件状态模式</p><h1>法律咨询 AI · 本机测试台</h1></div><button onClick={() => { setMessages([]); setInput(""); setCaseState({}); }}>新建咨询</button></header>
    <section className="labConversation" aria-live="polite">
      {messages.length === 0 && <div className="labEmpty"><h2>开始测试咨询效果</h2><p>无需登录。请像真实用户一样描述问题，再连续补充事实，观察 AI 是否耐心追问并理解上下文。</p></div>}
      {messages.map((item, index) => <article className={`labMessage ${item.role}`} key={index}><span>{item.role === "user" ? "咨询者" : "法律咨询助手"}</span><div>{item.content}</div>{item.laws?.length ? <ToolReferences laws={item.laws} /> : null}{item.cases?.length ? <ToolReferences cases={item.cases} /> : null}</article>)}
      {loading && <article className="labMessage assistant"><span>法律咨询助手</span><div>正在认真分析…</div></article>}
    </section>
    <section className="labComposer"><textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); } }} placeholder="请输入法律咨询内容；Enter 发送，Shift + Enter 换行" rows={4} /><div><small>此入口仅限本机测试，不保存对话记录。</small><button disabled={!input.trim() || loading} onClick={submit}>发送咨询</button></div></section>
  </main>;
}

function ToolReferences({ laws, cases }: { laws?: LegalReference[]; cases?: CaseReference[] }) {
  if (laws?.length) return <section className="toolReferences"><b>法条匹配结果</b>{laws.map((law, index) => <article key={`${law.name}-${law.article}-${index}`}><strong>{law.name} {law.article}</strong><p>{law.text}</p></article>)}</section>;
  if (cases?.length) return <section className="toolReferences"><b>相似咨询案例参考</b>{cases.map((item, index) => <article key={`${item.keyword}-${index}`}><strong>{item.keyword || "相似咨询案例"}</strong><p>{item.assessment_conclusion || item.fact_summary}</p>{item.law_refs?.length ? <small>{item.law_refs.join("；")}</small> : null}</article>)}</section>;
  return null;
}
