import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("keeps application, database, brand and client-demo boundaries explicit", async () => {
  const [page, brand, demo] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("features/brand/client-brand.ts", root), "utf8"),
    readFile(new URL("demos/client-preview/index.html", root), "utf8"),
  ]);

  assert.match(page, /from "@\/features\/brand\/client-brand"/);
  assert.match(brand, /productName/);
  assert.match(brand, /consultationGreeting/);
  assert.match(demo, /<!doctype html>/i);
  await access(new URL("db/schema/index.ts", root));
  await access(new URL("db/migrations/0000_curvy_paladin.sql", root));
});
