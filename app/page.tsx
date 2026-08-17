/* eslint-disable jsx-a11y/no-autofocus */
"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { clientBrand } from "@/features/brand/client-brand";

type LegalReference = { name: string; article: string; text: string; region?: string; score?: number };
type CaseReference = { keyword?: string; fact_summary: string; assessment_conclusion?: string; law_refs?: string[]; score?: number };
type Message = { id?: string; role: "user" | "assistant"; content: string; time: string; contextId?: string; laws?: LegalReference[]; cases?: CaseReference[] };
type ConsultationEntry = { id: string; contextId: string; question: string; answer: string; businessType: string; status: "processing" | "answered" | "failed"; time: string; matched_laws?: LegalReference[]; matched_cases?: CaseReference[] };
type Account = { id: string; displayName: string; phone: string; role: "agent" | "group_admin" | "system_admin" };
type TeamMember = { id: string; name: string; phone: string; role: "agent" | "group_admin" | "system_admin"; status: "active" | "disabled"; groupId?: string | null; groupName: string; lastLoginAt: string | null; consultationCount: number };
type TeamOverview = { scope: "all" | "group"; canManageRoles: boolean; summary: { total: number; active: number; consultations: number; groups: number }; groups: Array<{ id: string; name: string; status: string; member_count: number }>; businessTypes: Array<{ name: string; count: number }>; users: TeamMember[] };
type AgentResult = { entryId?: string; answer: string; case_state?: Record<string, unknown>; matched_laws?: LegalReference[]; matched_cases?: CaseReference[] };

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    credentials: "include",
    headers: { "content-type": "application/json", ...init.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.message === "string" ? body.message : "服务暂时不可用，请稍后重试。");
  return body as T;
}

export default function Home() {
  const [collapsed, setCollapsed] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [historyPreview, setHistoryPreview] = useState<Message[] | null>(null);
  const [historyMessages, setHistoryMessages] = useState<Message[]>([]);
  const [nextHistoryCursor, setNextHistoryCursor] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [mainMode, setMainMode] = useState<"full" | "compact" | "icon">("full");
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [settingsOrigin, setSettingsOrigin] = useState<"chat" | "admin">("chat");
  const [page, setPage] = useState<"login" | "chat" | "settings" | "admin">("login");
  const [account, setAccount] = useState<Account | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const chatAreaRef = useRef<HTMLElement>(null);
  const accountTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ user: Account }>("/api/v1/auth/me", { method: "POST" }).then(({ user }) => {
      if (!cancelled) { setAccount(user); setPage("chat"); }
    }).catch(() => undefined).finally(() => { if (!cancelled) setAuthChecking(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const updateProfile = (event: Event) => setAccount((current) => current ? { ...current, displayName: (event as CustomEvent<string>).detail } : current);
    window.addEventListener("profile-updated", updateProfile);
    return () => window.removeEventListener("profile-updated", updateProfile);
  }, []);

  useEffect(() => {
    const element = chatAreaRef.current;
    if (!element) return;
    const updateMainLayout = () => {
      const width = element.clientWidth;
      setMainMode(width < 440 ? "icon" : width < 700 ? "compact" : "full");
    };
    const observer = new ResizeObserver(updateMainLayout);
    observer.observe(element);
    updateMainLayout();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!account || page === "login") return;
    let cancelled = false;
    api<{ entries: ConsultationEntry[]; activeContextId: string | null; nextCursor: string | null }>("/api/v1/consultations/history", { method: "POST" }).then(({ entries, activeContextId, nextCursor }) => {
      if (cancelled) return;
      const restored = entries.flatMap((entry) => [
        { id: `${entry.id}:question`, role: "user" as const, content: entry.question, time: new Date(entry.time).toLocaleString("zh-CN", { hour12: false }), contextId: entry.contextId },
        ...(entry.answer ? [{ id: `${entry.id}:answer`, role: "assistant" as const, content: entry.answer, time: new Date(entry.time).toLocaleString("zh-CN", { hour12: false }), contextId: entry.contextId, laws: entry.matched_laws, cases: entry.matched_cases }] : []),
      ]);
      setHistoryMessages(restored);
      setMessages(activeContextId ? restored.filter((message) => message.contextId === activeContextId) : []);
      setHistoryPreview(null);
      setNextHistoryCursor(nextCursor);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [account, page]);

  async function loadOlderHistory() {
    if (!nextHistoryCursor) return;
    const result = await api<{ entries: ConsultationEntry[]; nextCursor: string | null }>("/api/v1/consultations/history", { method: "POST", body: JSON.stringify({ cursor: nextHistoryCursor }) });
    const older = result.entries.flatMap((entry) => [
      { id: `${entry.id}:question`, role: "user" as const, content: entry.question, time: new Date(entry.time).toLocaleString("zh-CN", { hour12: false }), contextId: entry.contextId },
      ...(entry.answer ? [{ id: `${entry.id}:answer`, role: "assistant" as const, content: entry.answer, time: new Date(entry.time).toLocaleString("zh-CN", { hour12: false }), contextId: entry.contextId, laws: entry.matched_laws, cases: entry.matched_cases }] : []),
    ]);
    setHistoryMessages((current) => [...older, ...current]);
    setNextHistoryCursor(result.nextCursor);
  }

  async function clearChat() {
    if (messages.length && !window.confirm("清空当前聊天上下文？历史记录仍会保留在咨询刻度中。")) return;
    try {
      await api("/api/v1/consultations/context/clear", { method: "POST" });
      setMessages([]); setHistoryPreview(null); setInput("");
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "暂时无法清空，请稍后重试。");
    }
  }
  const consultationMarks = historyMessages.flatMap((message, index) => message.role === "user" ? [{ message, index, answer: historyMessages[index + 1]?.role === "assistant" ? historyMessages[index + 1] : null }] : []);
  function jumpToMark(index: number) {
    const selected = historyMessages[index];
    if (!selected) return;
    const elementId = `consultation-turn-${selected.id ?? index}`;
    const visible = document.getElementById(elementId);
    if (visible) return visible.scrollIntoView({ behavior: "smooth", block: "start" });
    const answer = historyMessages[index + 1]?.role === "assistant" ? historyMessages[index + 1] : null;
    setHistoryPreview([selected, ...(answer ? [answer] : [])]);
    window.setTimeout(() => document.getElementById(elementId)?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  async function submit() {
    const text = input.trim();
    if (!text || loading) return;
    const pendingId = crypto.randomUUID();
    const pendingQuestion: Message = { id: `${pendingId}:question`, role: "user", content: text, time: "刚刚" };
    setHistoryPreview(null);
    setMessages((items) => [...items, pendingQuestion]);
    setHistoryMessages((items) => [...items, pendingQuestion]);
    setInput("");
    setLoading(true);
    try {
      const result = await api<AgentResult>("/api/v1/consultations/messages", { method: "POST", body: JSON.stringify({ message: text, clientRequestId: pendingId }) });
      const answer: Message = { id: `${result.entryId ?? pendingId}:answer`, role: "assistant", content: result.answer, time: "刚刚", laws: result.matched_laws, cases: result.matched_cases };
      setMessages((items) => [...items, answer]);
      setHistoryMessages((items) => [...items, answer]);
    } catch (error) {
      setMessages((items) => [...items, { role: "assistant", content: error instanceof Error ? error.message : "服务暂时不可用，请稍后重试。", time: "刚刚" }]);
    } finally {
      setLoading(false);
    }
  }

  if (authChecking) return <main className="loginPage"><div className="authChecking">正在恢复登录状态…</div></main>;
  if (page === "login") return <LoginPage onLogin={(nextAccount) => { setAccount(nextAccount); setPage("chat"); }} />;

  const displayMessages = historyPreview ?? messages;

  return <main className="workspace">
    {page === "chat" && <aside className={`sidebar ${collapsed ? "isCollapsed" : ""}`}>
      <div className="sidebarHeader">
        <div className="mark">{clientBrand.logoText}</div>
        {!collapsed && <div className="brandName" title={clientBrand.productName}>{clientBrand.productName}</div>}
        <button className="sidebarAction collapseAction" onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? "展开侧栏" : "收起侧栏"}>{collapsed ? "›" : "‹"}</button>
      </div>
      <div className="sidebarActions">
        <button className="sidebarAction clearChatAction" onClick={() => void clearChat()} aria-label="清空当前聊天"><span>⌫</span>{collapsed ? "" : "清空当前聊天"}</button>
      </div>
      {!collapsed && <div className="topicPanel"><div className="sectionLabel">咨询刻度</div>{consultationMarks.length ? <div className="consultationMarks">{consultationMarks.map(({ message, answer, index }) => <button className="consultationMark" key={message.id ?? index} onClick={() => jumpToMark(index)} aria-label={`跳转至第 ${consultationMarks.findIndex((mark) => mark.index === index) + 1} 次咨询`}><i /><span>{message.time}</span><div className="markPreview"><b>问：{message.content.slice(0, 34)}{message.content.length > 34 ? "…" : ""}</b><small>答：{answer?.content.slice(0, 42) ?? "正在生成…"}{(answer?.content.length ?? 0) > 42 ? "…" : ""}</small></div></button>)}{nextHistoryCursor && <button className="loadOlderMarks" onClick={() => void loadOlderHistory()}>加载更早记录</button>}</div> : <p className="marksEmpty">咨询问答会按时间留在这里，点击刻度可快速回看。</p>}</div>}
      <div className="sidebarUser">
        {accountMenuOpen && <AccountMenu anchorRef={accountTriggerRef} account={account} isAdmin={page === "admin" || account?.role === "system_admin" || account?.role === "group_admin"} onClose={() => setAccountMenuOpen(false)} onSettings={() => { setSettingsOrigin(page === "admin" ? "admin" : "chat"); setPage("settings"); setAccountMenuOpen(false); }} onAdmin={() => { setPage("admin"); setAccountMenuOpen(false); }} onLogout={async () => { await api("/api/v1/auth/logout", { method: "POST" }).catch(() => undefined); setAccount(null); setPage("login"); setAccountMenuOpen(false); }} />}
        <button ref={accountTriggerRef} className="accountTrigger" onClick={() => setAccountMenuOpen((open) => !open)} aria-label="账户菜单" aria-expanded={accountMenuOpen}><div className="userAvatar">{account?.displayName?.slice(0, 1) || "我"}</div>{!collapsed && <div className="userName">{account?.displayName || "账户"}<span>{account?.role === "system_admin" ? "系统管理员" : account?.role === "group_admin" ? "组长" : "坐席律师"}</span></div>}</button>
      </div>
    </aside>}
    <section ref={chatAreaRef} className={`chatArea mainMode-${mainMode} ${page === "admin" ? "adminArea" : ""}`}>
      <header className="topbar">{(page === "settings" || page === "admin") && <button className="topbarBack" onClick={() => setPage(page === "settings" ? settingsOrigin : "chat")}>← 返回{page === "settings" && settingsOrigin === "admin" ? "管理" : "咨询"}</button>}</header>
      {page === "settings" ? <SettingsPage account={account} onPhoneChanged={() => { setAccount(null); setPage("login"); }} /> : page === "admin" ? <AdminPage account={account} /> : <>{historyPreview && <div className="historyPreviewBar"><span>正在查看一条历史咨询</span><button onClick={() => setHistoryPreview(null)}>返回当前咨询</button></div>}<div className="conversation">{displayMessages.length === 0 ? <div className="emptyState"><div className="emptyMark">{clientBrand.logoText}</div>{mainMode !== "icon" && <><h1>{clientBrand.consultationGreeting}</h1><p>请输入您要咨询的法律问题</p></>}</div> : displayMessages.map((message, index) => <div id={message.role === "user" ? `consultation-turn-${message.id ?? index}` : undefined} className={`message ${message.role}`} key={message.id ?? `${message.time}-${index}`}><div className="messageAvatar">{message.role === "assistant" ? clientBrand.logoText : "坐"}</div><div className="messageBody"><div className="messageMeta"><b>{message.role === "assistant" ? clientBrand.assistantName : "坐席律师"}</b><time>{message.time}</time></div><div className="bubble">{message.content}</div>{message.laws?.length ? <ToolReferences laws={message.laws} /> : null}{message.cases?.length ? <ToolReferences cases={message.cases} /> : null}</div></div>)}{loading && <div className="message assistant"><div className="messageAvatar">{clientBrand.logoText}</div><div className="bubble loadingDots"><i /><i /><i /></div></div>}</div><div className="composerDock"><div className="composer"><textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); } }} placeholder="请输入您要咨询的法律问题…" rows={1} /><div className="composerFoot">{mainMode !== "icon" && <span>{mainMode === "compact" ? "AI 辅助内容，请结合实际判断" : "AI 生成内容仅供法律咨询辅助，请结合实际情况审慎判断"}</span>}<button className="send" onClick={submit} disabled={!input.trim() || loading}>发送</button></div></div></div></>}
    </section>
  </main>;
}

function ToolReferences({ laws, cases }: { laws?: LegalReference[]; cases?: CaseReference[] }) {
  if (laws?.length) return <section className="toolReferences"><b>法条匹配结果</b>{laws.map((law, index) => <article key={`${law.name}-${law.article}-${index}`}><strong>{law.name} {law.article}</strong><p>{law.text}</p></article>)}</section>;
  if (cases?.length) return <section className="toolReferences"><b>相似咨询案例参考</b>{cases.map((item, index) => <article key={`${item.keyword}-${index}`}><strong>{item.keyword || "相似咨询案例"}</strong><p>{item.assessment_conclusion || item.fact_summary}</p>{item.law_refs?.length ? <small>{item.law_refs.join("；")}</small> : null}</article>)}</section>;
  return null;
}

function AccountMenu({ anchorRef, account, isAdmin, onClose, onSettings, onAdmin, onLogout }: { anchorRef: RefObject<HTMLButtonElement | null>; account: Account | null; isAdmin: boolean; onClose: () => void; onSettings: () => void; onAdmin: () => void; onLogout: () => void }) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    function placeMenu() {
      const anchor = anchorRef.current; const menu = menuRef.current;
      if (!anchor || !menu) return;
      const rect = anchor.getBoundingClientRect(); const width = menu.offsetWidth; const height = menu.offsetHeight;
      const left = Math.min(Math.max(12, rect.left), window.innerWidth - width - 12);
      const top = rect.top >= height + 18 ? rect.top - height - 10 : Math.min(window.innerHeight - height - 12, rect.bottom + 10);
      setPosition({ left, top: Math.max(12, top) });
    }
    function closeFromOutside(event: PointerEvent) { const target = event.target as Node; if (!menuRef.current?.contains(target) && !anchorRef.current?.contains(target)) onClose(); }
    placeMenu();
    document.addEventListener("pointerdown", closeFromOutside);
    window.addEventListener("resize", placeMenu);
    window.addEventListener("scroll", placeMenu, true);
    return () => { document.removeEventListener("pointerdown", closeFromOutside); window.removeEventListener("resize", placeMenu); window.removeEventListener("scroll", placeMenu, true); };
  }, [anchorRef, onClose]);
  return createPortal(<div ref={menuRef} className="accountMenu accountMenuPortal" style={position ? { left: position.left, top: position.top, visibility: "visible" } : { visibility: "hidden" }}><div className="accountOverview"><div className="userAvatar">{account?.displayName?.slice(0, 1) || "我"}</div><span>{account?.displayName || "账户资料"}<small>{isAdmin ? "管理员" : "坐席律师"}</small></span></div><div className="menuDivider" /><button onClick={onSettings}><i>•</i>账户设置</button>{isAdmin && <button onClick={onAdmin}><i>•</i>团队管理</button>}<div className="menuDivider" /><button className="logout" onClick={onLogout}><i>•</i>退出登录</button></div>, document.body);
}

function SettingsPage({ account, onPhoneChanged }: { account: Account | null; onPhoneChanged: () => void }) {
  const [phoneChangeOpen, setPhoneChangeOpen] = useState(false);
  const [editingName, setEditingName] = useState(false); const [displayName, setDisplayName] = useState(account?.displayName ?? ""); const [profileBusy, setProfileBusy] = useState(false); const [profileMessage, setProfileMessage] = useState("");
  async function saveName() { const name = displayName.trim(); if (name.length < 2 || name.length > 80 || profileBusy) return; setProfileBusy(true); setProfileMessage(""); try { await api("/api/v1/account/profile", { method: "POST", body: JSON.stringify({ displayName: name }) }); window.dispatchEvent(new CustomEvent("profile-updated", { detail: name })); setEditingName(false); setProfileMessage("显示名称已更新"); } catch (error) { setProfileMessage(error instanceof Error ? error.message : "修改失败，请稍后重试。"); } finally { setProfileBusy(false); } }
  return <div className="settingsPage"><div className="settingsContent"><div className="settingsTitle"><p>账户资料</p><h1>设置</h1><span>管理当前账户的个人资料与绑定手机号。</span></div><section className="settingsCard"><h2>个人资料</h2><div className="settingsRow profileNameRow"><span>显示名称</span>{editingName ? <div className="profileNameEditor"><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={80} autoFocus /><button onClick={() => { setEditingName(false); setDisplayName(account?.displayName ?? ""); }}>取消</button><button className="primary" disabled={profileBusy || displayName.trim().length < 2} onClick={() => void saveName()}>保存</button></div> : <div className="profileNameValue"><b>{account?.displayName || "待账户服务载入"}</b><button onClick={() => setEditingName(true)}>修改</button></div>}</div>{profileMessage && <div className="profileMessage">{profileMessage}</div>}<div className="settingsRow"><span>头像</span><button disabled>由账户服务管理</button></div></section><section className="settingsCard"><h2>绑定联系方式</h2><div className="settingsRow"><span>绑定手机号</span><b>{account?.phone || "待账户服务载入"}</b></div><button className="settingsAction" onClick={() => setPhoneChangeOpen(true)}>换绑手机号</button></section></div>{phoneChangeOpen && <PhoneChangeModal currentPhone={account?.phone ?? ""} onClose={() => setPhoneChangeOpen(false)} onCompleted={onPhoneChanged} />}</div>;
}

function PhoneChangeModal({ currentPhone, onClose, onCompleted }: { currentPhone: string; onClose: () => void; onCompleted: () => void }) {
  const [step, setStep] = useState<"old" | "new">("old"); const [phone, setPhone] = useState(""); const [code, setCode] = useState(""); const [proof, setProof] = useState(""); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false); const [countdown, setCountdown] = useState(0);
  const validPhone = /^1\d{10}$/.test(phone); const validCode = /^\d{6}$/.test(code);
  async function sendCode() { if (!validPhone || busy || countdown) return; setBusy(true); setMessage(""); try { await api("/api/v1/account/phone/send", { method: "POST", body: JSON.stringify({ step, phone }) }); setMessage("验证码已发送，请查收短信。"); setCountdown(60); const timer = window.setInterval(() => setCountdown((value) => { if (value <= 1) { window.clearInterval(timer); return 0; } return value - 1; }), 1000); } catch (error) { setMessage(error instanceof Error ? error.message : "发送失败，请稍后重试。"); } finally { setBusy(false); } }
  async function verify() { if (!validPhone || !validCode || busy) return; setBusy(true); setMessage(""); try { if (step === "old") { const result = await api<{ proof: string }>("/api/v1/account/phone/verify-old", { method: "POST", body: JSON.stringify({ phone, code }) }); setProof(result.proof); setStep("new"); setPhone(""); setCode(""); setCountdown(0); setMessage("原手机号验证成功，请验证新手机号。"); } else { await api("/api/v1/account/phone/verify-new", { method: "POST", body: JSON.stringify({ phone, code, proof }) }); onCompleted(); } } catch (error) { setMessage(error instanceof Error ? error.message : "验证失败，请稍后重试。"); } finally { setBusy(false); } }
  return <div className="modalBackdrop" role="presentation"><section className="phoneChangeModal" role="dialog" aria-modal="true" aria-labelledby="phoneChangeTitle"><button className="modalClose" onClick={onClose} aria-label="关闭">×</button><p className="modalStep">步骤 {step === "old" ? "1" : "2"} / 2</p><h2 id="phoneChangeTitle">{step === "old" ? "验证原手机号" : "验证新手机号"}</h2><p>{step === "old" ? "请手动输入当前绑定的手机号并完成验证。" : "请输入新的手机号；完成验证后将退出当前登录。"}</p><label>{step === "old" ? "当前绑定手机号" : "新手机号"}<input value={phone} onChange={(event) => { setPhone(event.target.value.replace(/\D/g, "")); setMessage(""); }} inputMode="numeric" maxLength={11} placeholder={step === "old" ? currentPhone : "请输入新手机号"} /></label><label>验证码<div className="verificationLine"><input value={code} onChange={(event) => { setCode(event.target.value.replace(/\D/g, "")); setMessage(""); }} inputMode="numeric" maxLength={6} placeholder="请输入 6 位验证码" /><button disabled={!validPhone || busy || countdown > 0} onClick={sendCode}>{countdown ? `${countdown}s 后重试` : "发送验证码"}</button></div></label>{message && <div className="phoneChangeMessage">{message}</div>}<div className="modalActions"><button onClick={onClose}>取消</button><button className="primary" disabled={!validPhone || !validCode || busy} onClick={verify}>{step === "old" ? "验证原手机号" : "确认换绑"}</button></div></section></div>;
}

function LoginPage({ onLogin }: { onLogin: (account: Account) => void }) {
  const [phone, setPhone] = useState("");
  const [credential, setCredential] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [message, setMessage] = useState("");
  const validPhone = /^1\d{10}$/.test(phone);
  const validCredential = /^\d{6}$/.test(credential);
  async function sendCode() { if (!validPhone || countdown) return; try { await api("/api/v1/auth/sms/send", { method: "POST", body: JSON.stringify({ phone, purpose: "login" }) }); setMessage("验证码已发送，请查收短信。"); setCountdown(60); const timer = window.setInterval(() => setCountdown((value) => { if (value <= 1) { window.clearInterval(timer); return 0; } return value - 1; }), 1000); } catch (error) { setMessage(error instanceof Error ? error.message : "发送失败，请稍后重试。"); } }
  async function login() { try { const result = await api<{ user: Account }>("/api/v1/auth/sms/verify", { method: "POST", body: JSON.stringify({ phone, code: credential, purpose: "login" }) }); onLogin(result.user); } catch (error) { setMessage(error instanceof Error ? error.message : "登录失败，请稍后重试。"); } }
  return <main className="loginPage"><div className="loginShell"><section className="loginBrandPanel"><div className="tenantLogo" aria-label="客户品牌标志">{clientBrand.logoUrl ? <Image src={clientBrand.logoUrl} alt="客户品牌标志" width={64} height={64} unoptimized /> : clientBrand.logoText}</div><h1>{clientBrand.productName}</h1><p>{clientBrand.slogan}</p></section><section className="loginFormPanel"><div className="loginPanel"><h1>{clientBrand.loginGreeting}</h1><p>{clientBrand.loginPrompt}</p><div className="loginTabs"><button className="active">短信验证码</button></div><label>手机号<input value={phone} onChange={(event) => { setPhone(event.target.value.replace(/\D/g, "")); setMessage(""); }} inputMode="numeric" maxLength={11} placeholder="请输入手机号" /></label><label>验证码<div className="verificationLine"><input value={credential} onChange={(event) => setCredential(event.target.value.replace(/\D/g, ""))} inputMode="numeric" maxLength={6} placeholder="请输入 6 位验证码" /><button disabled={!validPhone || countdown > 0} onClick={sendCode}>{countdown ? `${countdown}s 后重试` : "获取验证码"}</button></div></label>{message && <div className="loginMessage">{message}</div>}<label className="agreement"><input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} />我已阅读并同意相关服务协议</label><button className="loginSubmit" disabled={!validPhone || !validCredential || !agreed} onClick={login}>登录</button></div></section></div></main>;
}

function AdminPage({ account }: { account: Account | null }) {
  const [overview, setOverview] = useState<TeamOverview | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [groupName, setGroupName] = useState("");
  const [newUser, setNewUser] = useState({ displayName: "", phone: "", role: "agent", groupId: "" });
  const [toast, setToast] = useState<{ text: string; tone: "success" | "error" } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchRole, setBatchRole] = useState("__keep__");
  const [batchGroup, setBatchGroup] = useState("__keep__");
  const [batchOpen, setBatchOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<TeamOverview["groups"][number] | null>(null);
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null);
  const [editRole, setEditRole] = useState<"agent" | "group_admin">("agent");
  const [editGroupId, setEditGroupId] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const systemAdmin = account?.role === "system_admin";
  const load = useCallback(async (initial = false) => { if (initial) setLoading(true); try { setOverview(await api<TeamOverview>("/api/v1/team/overview", { method: "POST" })); setLoadError(""); } catch (error) { setLoadError(error instanceof Error ? error.message : "团队信息暂时不可用"); } finally { if (initial) setLoading(false); } }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(true), 0); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(null), 2600); return () => window.clearTimeout(timer); }, [toast]);
  async function runAction(task: () => Promise<unknown>, success: string) { if (actionBusy) return false; setActionBusy(true); try { await task(); await load(); setToast({ text: success, tone: "success" }); return true; } catch (error) { setToast({ text: error instanceof Error ? error.message : "操作失败，请稍后重试。", tone: "error" }); return false; } finally { setActionBusy(false); } }
  async function setStatus(member: TeamMember, status: "active" | "disabled") { await runAction(() => api("/api/v1/team/user/status", { method: "POST", body: JSON.stringify({ userId: member.id, status }) }), status === "active" ? "账号已启用" : "账号已禁用，登录会话已撤销"); }
  async function createGroup() { if (!groupName.trim()) return; if (await runAction(() => api("/api/v1/team/groups/create", { method: "POST", body: JSON.stringify({ name: groupName.trim() }) }), "成员组已创建")) setGroupName(""); }
  async function renameGroup(groupId: string, name: string) { return runAction(() => api("/api/v1/team/groups/update", { method: "POST", body: JSON.stringify({ groupId, name }) }), "成员组名称已修改"); }
  async function deleteGroup(group: TeamOverview["groups"][number]) { if (!window.confirm(`确定删除“${group.name}”吗？组内成员将变为未加入成员组，组长将调整为坐席律师。`)) return; await runAction(() => api("/api/v1/team/groups/delete", { method: "POST", body: JSON.stringify({ groupId: group.id }) }), "成员组已删除"); }
  async function createUser() { if (await runAction(() => api("/api/v1/team/users/create", { method: "POST", body: JSON.stringify(newUser) }), "成员已添加，可直接使用手机号登录")) setNewUser({ displayName: "", phone: "", role: "agent", groupId: "" }); }
  async function updateAssignment(member: TeamMember, role: "agent" | "group_admin", groupId: string) { return runAction(() => api("/api/v1/team/users/update", { method: "POST", body: JSON.stringify({ userId: member.id, role, groupId: groupId || null }) }), `“${member.name}”的身份与成员组已更新`); }
  function openMemberEditor(member: TeamMember) { setEditingMember(member); setEditRole(member.role === "group_admin" ? "group_admin" : "agent"); setEditGroupId(member.groupId ?? ""); }
  async function deleteUser(member: TeamMember) { if (!window.confirm(`确定删除“${member.name}”吗？该账号将立即退出，但历史统计仍保留。`)) return; if (await runAction(() => api("/api/v1/team/users/delete", { method: "POST", body: JSON.stringify({ userId: member.id }) }), "账号已删除")) setSelectedIds((current) => { const next = new Set(current); next.delete(member.id); return next; }); }
  async function submitBatch() {
    if (!overview || !selectedIds.size) return;
    const members = overview.users.filter((member) => selectedIds.has(member.id) && member.role !== "system_admin");
    const updates = members.map((member) => ({ userId: member.id, role: batchRole === "__keep__" ? member.role : batchRole, groupId: batchGroup === "__keep__" ? member.groupId ?? null : batchGroup || null }));
    if (updates.some((item) => item.role === "group_admin" && !item.groupId)) { setToast({ text: "组长必须归属一个成员组", tone: "error" }); return; }
    if (await runAction(() => api("/api/v1/team/users/batch-update", { method: "POST", body: JSON.stringify({ updates }) }), `已提交 ${updates.length} 名成员的修改`)) { setSelectedIds(new Set()); setBatchRole("__keep__"); setBatchGroup("__keep__"); setBatchOpen(false); }
  }
  const editableMembers = overview?.users.filter((member) => member.role !== "system_admin") ?? [];
  const allSelected = editableMembers.length > 0 && editableMembers.every((member) => selectedIds.has(member.id));
  return <div className="settingsPage">{toast && <div className={`adminToast ${toast.tone}`} role="status">{toast.text}</div>}<div className="settingsContent adminContent">
    <div className="settingsTitle"><p>{systemAdmin ? "全局团队与权限" : "本组成员与使用情况"}</p><h1>{systemAdmin ? "团队管理" : "我的团队"}</h1><span>{systemAdmin ? "系统管理员始终唯一；人员交接只通过该账号换绑手机号完成。" : "你只能查看和启停本组普通用户，不能改角色、删除账号或查看咨询全文。"}</span></div>
    {loadError && <div className="adminNotice">{loadError}</div>}
    {loading ? <div className="adminEmpty">正在载入团队信息…</div> : overview && <>
      <section className="teamMetrics"><Metric label={systemAdmin ? "成员总数" : "本组成员"} value={overview.summary.total} /><Metric label="启用账号" value={overview.summary.active} /><Metric label="咨询问题" value={overview.summary.consultations} /><Metric label={systemAdmin ? "成员组" : "当前成员组"} value={overview.summary.groups} /></section>
      <section className="settingsCard"><div className="adminCardHead"><div><h2>咨询业务类型</h2><p>按每个律师问题独立归类；无法判断的短问题进入“其他/待确认”。</p></div></div><div className="categoryBars">{overview.businessTypes.length ? overview.businessTypes.map((item) => <div key={item.name}><span>{item.name}</span><i style={{ width: `${Math.max(8, item.count / Math.max(...overview.businessTypes.map((entry) => entry.count)) * 100)}%` }} /><b>{item.count}</b></div>) : <div className="adminEmpty">尚无咨询数据。</div>}</div></section>
      <section className="settingsCard"><div className="adminCardHead"><div><h2>{systemAdmin ? "成员组" : "我的成员组"}</h2><p>成员组决定组长可见和可管理的成员范围。</p></div></div>{systemAdmin && <div className="adminInlineForm alignedForm"><input value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder="输入新成员组名称" maxLength={80} /><button className="settingsAction" disabled={actionBusy || groupName.trim().length < 2} onClick={() => void createGroup()}>新建成员组</button></div>}<div className="groupCards">{overview.groups.length ? overview.groups.map((group) => <article key={group.id}><div className="groupCardHead"><b>{group.name}</b>{systemAdmin && <div><button onClick={() => setEditingGroup(group)}>编辑</button><button className="danger" onClick={() => void deleteGroup(group)}>删除</button></div>}</div><span>{group.member_count} 名成员</span><small>{group.status === "active" ? "正常" : "已停用"}</small></article>) : <div className="adminEmpty">尚未建立成员组。</div>}</div></section>
      {systemAdmin && <section className="settingsCard"><div className="adminCardHead"><div><h2>预录入成员</h2><p>首次登录仍会自动注册普通用户；这里用于提前设置姓名、成员组或组长身份。</p></div></div><div className="adminUserForm alignedForm"><input value={newUser.displayName} onChange={(event) => setNewUser({ ...newUser, displayName: event.target.value })} placeholder="姓名" /><input value={newUser.phone} onChange={(event) => setNewUser({ ...newUser, phone: event.target.value.replace(/\D/g, "") })} placeholder="手机号" maxLength={11} inputMode="numeric" /><select value={newUser.role} onChange={(event) => setNewUser({ ...newUser, role: event.target.value })}><option value="agent">坐席律师</option><option value="group_admin">组长</option></select><select value={newUser.groupId} onChange={(event) => setNewUser({ ...newUser, groupId: event.target.value })}><option value="">未加入成员组</option>{overview.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select><button className="settingsAction" disabled={actionBusy || !newUser.displayName.trim() || !/^1\d{10}$/.test(newUser.phone) || (newUser.role === "group_admin" && !newUser.groupId)} onClick={() => void createUser()}>添加成员</button></div></section>}
      <section className="settingsCard memberManagementCard"><div className="adminCardHead"><div><h2>{systemAdmin ? "全部成员" : "本组成员"}</h2><p>点击单个成员编辑，或勾选多名成员后统一调整。</p></div>{systemAdmin && selectedIds.size > 0 && <button className="batchEntry" onClick={() => setBatchOpen(true)}>批量修改 · {selectedIds.size} 人</button>}</div><div className={`memberTable ${systemAdmin ? "withSelection" : ""}`}><div className="memberHead">{systemAdmin && <input type="checkbox" aria-label="选择全部可编辑成员" checked={allSelected} onChange={() => setSelectedIds(allSelected ? new Set() : new Set(editableMembers.map((member) => member.id)))} />}<span>成员</span><span>身份 / 成员组</span><span>账号 / 咨询</span><span>最近登录</span><span>操作</span></div>{overview.users.map((member) => <div className="memberRecord" key={member.id}><div className="memberRow">{systemAdmin && <input type="checkbox" aria-label={`选择${member.name}`} disabled={member.role === "system_admin"} checked={selectedIds.has(member.id)} onChange={() => setSelectedIds((current) => { const next = new Set(current); if (next.has(member.id)) next.delete(member.id); else next.add(member.id); return next; })} />}<div><b>{member.name}</b><small>{member.phone}</small></div><div><span className={`roleTag ${member.role}`}>{member.role === "system_admin" ? "系统管理员" : member.role === "group_admin" ? "组长" : "坐席律师"}</span><small>{member.groupName}</small></div><div><span className={`statusTag ${member.status}`}>{member.status === "active" ? "已启用" : "已禁用"}</span><small>{member.consultationCount} 个问题</small></div><div><small>{member.lastLoginAt ? new Date(member.lastLoginAt).toLocaleString("zh-CN", { hour12: false }) : "尚未登录"}</small></div><div className="memberActions">{systemAdmin && member.role !== "system_admin" && <button className="memberAction primary" onClick={() => editingMember?.id === member.id ? setEditingMember(null) : openMemberEditor(member)}>{editingMember?.id === member.id ? "收起" : "编辑"}</button>}{member.role !== "system_admin" && <button className="memberAction" onClick={() => void setStatus(member, member.status === "active" ? "disabled" : "active")}>{member.status === "active" ? "禁用" : "启用"}</button>}{systemAdmin && member.role !== "system_admin" && <button className="memberAction danger" onClick={() => void deleteUser(member)}>删除</button>}</div></div>{editingMember?.id === member.id && <div className="memberInlineEditor"><label>成员身份<select value={editRole} onChange={(event) => setEditRole(event.target.value as "agent" | "group_admin")}><option value="agent">坐席律师</option><option value="group_admin">组长</option></select></label><label>所属成员组<select value={editGroupId} onChange={(event) => setEditGroupId(event.target.value)}><option value="">未加入成员组</option>{overview.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label><div><button onClick={() => setEditingMember(null)}>取消</button><button className="primary" disabled={actionBusy || (editRole === "group_admin" && !editGroupId)} onClick={async () => { if (await updateAssignment(member, editRole, editGroupId)) setEditingMember(null); }}>保存修改</button></div></div>}</div>)}</div></section>
    </>}
  </div>{editingGroup && <GroupEditModal group={editingGroup} busy={actionBusy} onClose={() => setEditingGroup(null)} onSave={async (name) => { if (await renameGroup(editingGroup.id, name)) setEditingGroup(null); }} />}{batchOpen && overview && <BatchEditModal count={selectedIds.size} groups={overview.groups} role={batchRole} groupId={batchGroup} busy={actionBusy} onRoleChange={setBatchRole} onGroupChange={setBatchGroup} onClose={() => setBatchOpen(false)} onSubmit={() => void submitBatch()} />}</div>;
}

function GroupEditModal({ group, busy, onClose, onSave }: { group: TeamOverview["groups"][number]; busy: boolean; onClose: () => void; onSave: (name: string) => Promise<void> }) {
  const [name, setName] = useState(group.name);
  return <div className="modalBackdrop" role="presentation"><section className="memberEditModal" role="dialog" aria-modal="true" aria-labelledby="groupEditTitle"><button className="modalClose" onClick={onClose} aria-label="关闭">×</button><p className="modalStep">成员组</p><h2 id="groupEditTitle">修改成员组名称</h2><p>修改后，组内成员的归属不会改变。</p><label>成员组名称<input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} /></label><div className="modalActions"><button onClick={onClose}>取消</button><button className="primary" disabled={busy || name.trim().length < 2 || name.trim() === group.name} onClick={() => void onSave(name.trim())}>保存修改</button></div></section></div>;
}

function BatchEditModal({ count, groups, role, groupId, busy, onRoleChange, onGroupChange, onClose, onSubmit }: { count: number; groups: TeamOverview["groups"]; role: string; groupId: string; busy: boolean; onRoleChange: (value: string) => void; onGroupChange: (value: string) => void; onClose: () => void; onSubmit: () => void }) {
  return <div className="modalBackdrop" role="presentation"><section className="memberEditModal batchEditModal" role="dialog" aria-modal="true" aria-labelledby="batchEditTitle"><button className="modalClose" onClick={onClose} aria-label="关闭">×</button><p className="modalStep">批量操作</p><h2 id="batchEditTitle">修改 {count} 名成员</h2><p>只会修改你明确选择的项目，保持不变的项目不会被覆盖。</p><label>成员身份<select value={role} onChange={(event) => onRoleChange(event.target.value)}><option value="__keep__">保持不变</option><option value="agent">统一为坐席律师</option><option value="group_admin">统一为组长</option></select></label><label>所属成员组<select value={groupId} onChange={(event) => onGroupChange(event.target.value)}><option value="__keep__">保持不变</option><option value="">未加入成员组</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label><div className="modalActions"><button onClick={onClose}>取消</button><button className="primary" disabled={busy || (role === "__keep__" && groupId === "__keep__")} onClick={onSubmit}>确认修改</button></div></section></div>;
}

function Metric({ label, value }: { label: string; value: number }) { return <article><span>{label}</span><b>{value}</b></article>; }
