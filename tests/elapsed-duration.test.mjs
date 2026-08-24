import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { formatElapsedDuration } from "../features/consultation/elapsed.mjs";

test("formats consultation elapsed time in minutes and seconds", () => {
  assert.equal(formatElapsedDuration(0), "耗时 0分0秒");
  assert.equal(formatElapsedDuration(1_250), "耗时 0分1秒");
  assert.equal(formatElapsedDuration(61_100), "耗时 1分1秒");
});

test("assistant message metadata shows response elapsed time instead of a clock time", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /typeof message\.elapsedMs === "number" \? <time>\{formatElapsedDuration\(message\.elapsedMs\)\}<\/time> : null/);
  assert.doesNotMatch(page, /responseElapsed/);
});

test("waiting reply shows an elapsed timer that refreshes every second", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /const \[requestStartedAt, setRequestStartedAt\] = useState<number \| null>\(null\)/);
  assert.match(page, /window\.setInterval\(updateElapsed, 1_000\)/);
  assert.match(page, /const startedAt = performance\.now\(\);\s+setRequestStartedAt\(startedAt\)/);
  assert.match(page, /formatElapsedDuration\(loadingElapsedMs\)/);
});

test("consultation client receives core and complete answer segments from the safe stream", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /async function consultationStream/);
  assert.match(page, /\/api\/v1\/consultations\/stream/);
  assert.match(page, /event === "core_delta"/);
  assert.match(page, /event === "answer_delta"/);
  assert.match(page, /event === "complete"/);
});

test("complete answer replaces the core preview and carries tool references atomically", async () => {
  const [page, api] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../backend/server.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(page, /const hasCore = items\.some\(\(item\) => item\.id === `\$\{pendingId\}:core`\)/);
  assert.match(page, /hasCore \? items\.map\(\(item\) => item\.id === `\$\{pendingId\}:core` \? answer : item\)/);
  assert.match(page, /laws: Array\.isArray\(data\.matched_laws\)/);
  assert.match(page, /cases: Array\.isArray\(data\.matched_cases\)/);
  assert.match(api, /sendSse\(response, "answer_delta", \{ content: delivery\.response, matched_laws: full\.agent\.matched_laws, matched_cases: full\.agent\.matched_cases/);
  assert.match(page, /laws\?\.length \? <section className="toolReferences"/);
  assert.match(page, /cases\?\.length \? <CaseReferences cases=\{cases\}/);
});

test("consultation composer is vertically resizable and follows the newest turn", async () => {
  const [page, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/styles/authenticated-theme.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /const conversationRef = useRef<HTMLDivElement>\(null\)/);
  assert.match(page, /const element = conversationRef\.current/);
  assert.match(page, /<div ref=\{conversationRef\} className="conversation">/);
  assert.match(page, /window\.requestAnimationFrame\(\(\) => element\.scrollTo\(\{ top: element\.scrollHeight/);
  assert.match(page, /\[messages, loading\]/);
  assert.match(page, /const \[composerHeight, setComposerHeight\] = useState\(88\)/);
  assert.match(page, /className="composerResizeHandle"/);
  assert.match(page, /onPointerDown=\{startComposerResize\}/);
  assert.match(page, /style=\{\{ height: composerHeight \}\}/);
  assert.match(styles, /\.workspace \.composer textarea\s*\{[^}]*min-height:\s*64px[^}]*max-height:\s*200px[^}]*resize:\s*none !important/s);
  assert.match(styles, /\.composerResizeHandle\s*\{[^}]*cursor:\s*ns-resize/s);
});

test("core reply keeps one assistant turn and the composer starts as a multi-line field", async () => {
  const [page, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/styles/authenticated-theme.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /const corePreviewVisible = messages\.some\(\(message\) => message\.id\?\.endsWith\(":core"\)\)/);
  assert.match(page, /message\.id\?\.endsWith\(":core"\) && loading \? <time>\{formatElapsedDuration\(loadingElapsedMs\)\}/);
  assert.match(page, /loading && !corePreviewVisible/);
  assert.match(page, /message\.role === "user" \? <div className="messageAvatar">/);
  assert.match(page, /placeholder="请输入您要咨询的法律问题…" rows=\{3\}/);
  assert.match(styles, /\.workspace \.composer textarea\s*\{[^}]*min-height:\s*76px[^}]*max-height:\s*260px[^}]*resize:\s*vertical/s);
});

test("user messages do not render a redundant name above their bubble", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /message\.role === "assistant" \? <div className="messageMeta"><b>\{clientBrand\.assistantName\}<\/b>/);
  assert.doesNotMatch(page, /message\.role === "assistant" \? clientBrand\.assistantName : account\?\.displayName \|\| "账户"/);
});

test("tool references use lawyer-facing titles", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, />相关法条<\/b>/);
  assert.match(page, />类似案例<\/b>/);
  assert.doesNotMatch(page, /法条匹配（工具）|类案匹配（工具）/);
});

test("disabled member-management actions retain readable contrast", async () => {
  const styles = await readFile(new URL("../app/styles/authenticated-theme.css", import.meta.url), "utf8");

  assert.match(styles, /\.workspace \.alignedForm button:disabled\s*\{[^}]*opacity:\s*1[^}]*color:\s*#fff/s);
  assert.match(styles, /\.workspace \.alignedForm \.settingsAction\s*\{[^}]*color:\s*#fff/s);
  assert.match(styles, /\.workspace \.settingsAction\s*\{[^}]*color:\s*#fff/s);
});

test("settings does not present account-managed avatars as an action", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(page, /由账户服务管理/);
  assert.doesNotMatch(page, /<span>头像<\/span>/);
});
