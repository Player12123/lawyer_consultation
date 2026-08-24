import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("consultation timeline groups the visible seven-day history into collapsible days", async () => {
  const page = await readFile(new URL("app/page.tsx", root), "utf8");

  assert.match(page, /const visibleHistoryEntries = .*7/s);
  assert.match(page, /const timelineDays = /);
  assert.match(page, /function formatTimelineTime/);
  assert.match(page, /function formatTimelineDay/);
  assert.match(page, /setExpandedTimelineDays/);
});

test("consultation timeline has a persistent selected mark and an in-sidebar preview", async () => {
  const [page, theme] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/styles/authenticated-theme.css", root), "utf8"),
  ]);

  assert.match(page, /setSelectedHistoryEntryId/);
  assert.match(page, /consultationMark.*isActive/s);
  assert.match(page, /markPreview/);
  assert.match(theme, /\.consultationMark\.isActive/);
  assert.match(theme, /\.timelineDayToggle/);
  assert.match(theme, /\.markPreview[\s\S]*inset-inline/);
});

test("history API remains a full backend record and is not deleted for the sidebar view", async () => {
  const api = await readFile(new URL("backend/server.mjs", root), "utf8");

  assert.match(api, /async function consultationHistory\(session, cursor = null\)/);
  assert.doesNotMatch(api, /DELETE FROM consultation_entries.*INTERVAL 7 DAY/s);
});

test("consultation renders first-pass tool references once and never injects them into the model answer", async () => {
  const page = await readFile(new URL("app/page.tsx", root), "utf8");

  assert.doesNotMatch(page, /fetchReferences/);
  assert.match(page, /<ToolReferences/);
  assert.match(page, /法条匹配/);
  assert.doesNotMatch(page, /nextContent = nextContent \+ "\\n\\n—— 相关法条 ——/);
});

test("case cards keep their expansion state aligned with the visible structured analysis", async () => {
  const page = await readFile(new URL("app/page.tsx", root), "utf8");

  assert.match(page, /assessment_reasoning/);
  assert.match(page, /risk_notes/);
  assert.match(page, /action_steps/);
  assert.match(page, /function CaseReferences/);
  assert.match(page, /const \[expandedCaseKey, setExpandedCaseKey\]/);
  assert.match(page, /open=\{isExpanded\}/);
  assert.match(page, /onToggle=\{\(event\)/);
  assert.match(page, /isExpanded \? "收起" : "展开"/);
  assert.match(page, /案情摘要/);
  assert.match(page, /裁判\/分析结论/);
  assert.match(page, /风险提示/);
  assert.match(page, /建议动作/);
  assert.match(page, /相关法条/);
});

test("case cards keep their ranking order but do not display repeated relevance percentages", async () => {
  const page = await readFile(new URL("app/page.tsx", root), "utf8");

  assert.match(page, /const \[expandedCaseKey, setExpandedCaseKey\]/);
  assert.doesNotMatch(page, /相关度 \$\{\(item\.score/);
});
