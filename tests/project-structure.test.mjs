import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("keeps application, database and brand boundaries explicit", async () => {
  const [page, brand] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("features/brand/client-brand.ts", root), "utf8"),
  ]);

  assert.match(page, /from "@\/features\/brand\/client-brand"/);
  assert.match(brand, /productName/);
  assert.match(brand, /consultationGreeting/);
  await access(new URL("db/schema/index.ts", root));
  await access(new URL("db/migrations/0000_curvy_paladin.sql", root));
});

test("company handover keeps only the ordinary web deployment surface", async () => {
  const [readme, packageJson, viteConfig] = await Promise.all([
    readFile(new URL("README.md", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
    readFile(new URL("vite.config.ts", root), "utf8"),
  ]);

  await assert.rejects(access(new URL(".openai/hosting.json", root)));
  await assert.rejects(access(new URL("worker/index.ts", root)));
  await assert.rejects(access(new URL("tooling/sites-vite-plugin.ts", root)));
  await assert.rejects(access(new URL("demos/client-preview/index.html", root)));
  assert.doesNotMatch(readme, /Cloudflare|Worker|demos|\.openai|临时演示|独立 HTML/);
  assert.doesNotMatch(packageJson, /@cloudflare\/vite-plugin|wrangler|WRANGLER_/);
  assert.doesNotMatch(viteConfig, /cloudflare|worker\/index|\.openai|sites-vite-plugin|WRANGLER_|MINIFLARE/);
});
