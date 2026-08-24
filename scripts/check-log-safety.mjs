import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../backend/server.mjs", import.meta.url), "utf8");
const unsafePatterns = [
  /console\.(?:log|info|warn|error)\(\s*(?:exception|cause|body\.(?:phone|code|message)|request\.headers|process\.env\.[A-Z0-9_]*(?:KEY|SECRET|PASSWORD|PEPPER))/,
  /console\.(?:log|info|warn|error)\([^\n]*\b(?:验证码|咨询原文|Authorization)\b/i,
];

const violations = unsafePatterns.flatMap((pattern) => {
  const match = source.match(pattern);
  return match ? [match[0]] : [];
});

if (violations.length) {
  console.error("Unsafe logging patterns detected:", violations);
  process.exit(1);
}

console.log("Sensitive logging guard passed.");
