import { createHash, randomBytes } from "node:crypto";
import dotenv from "dotenv";
import mysql from "mysql2/promise";

import {
  LAWYER_AGENT_PROMPT_KEY,
  LAWYER_AGENT_PROMPT,
  LAWYER_RESPONSE_PROMPT_KEY,
  LAWYER_RESPONSE_PROMPT,
} from "../backend/legal-agent-v2.mjs";

dotenv.config({ path: process.env.ENV_FILE ?? ".env.local" });

const tenantId = String(process.env.TENANT_ID ?? "").trim();
if (!tenantId || !process.env.DATABASE_URL) throw new Error("TENANT_ID 和 DATABASE_URL 必须配置");

const connection = await mysql.createConnection({ uri: process.env.DATABASE_URL });
const releaseName = "Prompt V9";
const definitions = [
  [LAWYER_RESPONSE_PROMPT_KEY, LAWYER_RESPONSE_PROMPT, `${releaseName}｜Responder：双工具均有结果时分别吸收法条规则与类案结论，保持结论优先与可扫读段落`],
];

try {
  for (const [promptKey, content, changeNote] of definitions) {
    const hash = createHash("sha256").update(content).digest("hex");
    await connection.beginTransaction();
    try {
      const [activeRows] = await connection.execute(
        "SELECT pv.id, pv.content_hash, pv.change_note FROM active_prompt_versions apv JOIN prompt_versions pv ON pv.id = apv.prompt_version_id WHERE apv.tenant_id = ? AND apv.prompt_key = ? FOR UPDATE",
        [tenantId, promptKey],
      );
      if (activeRows[0]?.content_hash === hash && String(activeRows[0]?.change_note ?? "").startsWith(releaseName)) {
        await connection.commit();
        console.info(`${promptKey}: active version already matches ${releaseName}`);
        continue;
      }
      const [versions] = await connection.execute(
        "SELECT version FROM prompt_versions WHERE tenant_id = ? AND prompt_key = ? ORDER BY version DESC LIMIT 1 FOR UPDATE",
        [tenantId, promptKey],
      );
      const version = Number(versions[0]?.version ?? 0) + 1;
      const promptId = randomBytes(16).toString("hex").slice(0, 26);
      await connection.execute(
        "UPDATE prompt_versions pv JOIN active_prompt_versions apv ON apv.prompt_version_id = pv.id SET pv.status = 'archived' WHERE apv.tenant_id = ? AND apv.prompt_key = ?",
        [tenantId, promptKey],
      );
      await connection.execute(
        "INSERT INTO prompt_versions (id, tenant_id, prompt_key, version, status, content, content_hash, change_note, activated_at) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, NOW())",
        [promptId, tenantId, promptKey, version, content, hash, changeNote],
      );
      await connection.execute(
        "INSERT INTO active_prompt_versions (tenant_id, prompt_key, prompt_version_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE prompt_version_id = VALUES(prompt_version_id)",
        [tenantId, promptKey, promptId],
      );
      await connection.commit();
      console.info(`${promptKey}: published version ${version}`);
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  }
} finally {
  await connection.end();
}
