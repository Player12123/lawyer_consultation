import { char, datetime, index, int, mysqlEnum, mysqlTable, primaryKey, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
import { tenants, users } from "./users";

/** Versioned instructions used by the consultation agent. */
export const promptVersions = mysqlTable("prompt_versions", {
  id: char("id", { length: 26 }).primaryKey(),
  tenantId: char("tenant_id", { length: 26 }).notNull().references(() => tenants.id),
  promptKey: varchar("prompt_key", { length: 80 }).notNull(),
  version: int("version", { unsigned: true }).notNull(),
  status: mysqlEnum("status", ["draft", "active", "archived"]).notNull().default("draft"),
  content: text("content").notNull(),
  contentHash: char("content_hash", { length: 64 }).notNull(),
  changeNote: varchar("change_note", { length: 500 }),
  createdByUserId: char("created_by_user_id", { length: 26 }).references(() => users.id, { onDelete: "set null" }),
  activatedAt: datetime("activated_at", { mode: "date" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prompt_versions_tenant_key_version_unique").on(table.tenantId, table.promptKey, table.version),
  index("prompt_versions_active_idx").on(table.tenantId, table.promptKey, table.status),
]);

/** One authoritative active version for each tenant and prompt purpose. */
export const activePromptVersions = mysqlTable("active_prompt_versions", {
  tenantId: char("tenant_id", { length: 26 }).notNull().references(() => tenants.id, { onDelete: "cascade" }),
  promptKey: varchar("prompt_key", { length: 80 }).notNull(),
  promptVersionId: char("prompt_version_id", { length: 26 }).notNull().references(() => promptVersions.id, { onDelete: "restrict" }),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
}, (table) => [
  primaryKey({ columns: [table.tenantId, table.promptKey] }),
  uniqueIndex("active_prompt_versions_version_unique").on(table.promptVersionId),
]);
