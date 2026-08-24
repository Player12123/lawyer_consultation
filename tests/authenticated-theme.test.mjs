import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("defines the approved blue-to-cyan visual system for authenticated screens", async () => {
  const theme = await readFile(new URL("app/styles/authenticated-theme.css", root), "utf8");

  for (const token of [
    "--primary: #1b6bff",
    "--primary-hover: #1557e0",
    "--primary-active: #0d47a1",
    "--accent: #00b8d9",
    "--page: #f4f7fc",
    "--surface: #ffffff",
    "--border: #dfe6ee",
  ]) assert.match(theme, new RegExp(token, "i"));

  assert.match(theme, /\.workspace \.sidebar\s*\{[\s\S]*linear-gradient\(180deg,\s*var\(--primary-active\)/);
  assert.match(theme, /\.workspace \.chatArea\s*\{[\s\S]*var\(--page\)/);
  assert.match(theme, /\.workspace \.send,[\s\S]*\.workspace \.settingsAction,[\s\S]*\.workspace \.batchEntry[\s\S]*linear-gradient\(90deg,\s*var\(--primary-active\)/);
  assert.match(theme, /\.workspace \.mark,[\s\S]*\.workspace \.emptyMark,[\s\S]*\.workspace \.messageAvatar\s*\{[\s\S]*var\(--warm\)/);
  assert.doesNotMatch(theme, /\.login(?:Page|Shell|BrandPanel|FormPanel|Panel|Submit)/);
});
