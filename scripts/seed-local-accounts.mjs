import dotenv from "dotenv";
import mysql from "mysql2/promise";
dotenv.config({ path: ".env.local" });

const databaseUrl = process.env.DATABASE_URL ?? "mysql://root@127.0.0.1:3306/pocket_legal_assistant";
const accounts = [
  { id: "01J00000000000000000000001", phone: "13800138001", displayName: "测试坐席", role: "agent" },
];
const localTenant = { id: "01J00000000000000000000000", name: "本地测试租户" };

const pool = mysql.createPool(databaseUrl);

try {
  await pool.execute("INSERT IGNORE INTO tenants (id, name, status) VALUES (?, ?, 'active')", [localTenant.id, localTenant.name]);
  for (const account of accounts) {
    const [existing] = await pool.query("SELECT id FROM users WHERE tenant_id = ? AND phone = ? LIMIT 1", [localTenant.id, account.phone]);
    if (existing.length) continue;

    await pool.execute(
      "INSERT INTO users (id, tenant_id, phone, display_name, role, status) VALUES (?, ?, ?, ?, ?, 'active')",
      [account.id, localTenant.id, account.phone, account.displayName, account.role],
    );
    await pool.execute(
      "INSERT INTO audit_events (tenant_id, actor_user_id, event_type, target_type, target_id, occurred_at) VALUES (?, ?, 'system.local_test_agent.provisioned', 'user', ?, NOW())",
      [localTenant.id, account.id, account.id],
    );
  }
  console.log("Local test accounts are ready.");
} finally {
  await pool.end();
}
