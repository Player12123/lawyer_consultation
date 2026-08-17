import { char, datetime, index, int, mysqlEnum, mysqlTable, timestamp, varchar } from "drizzle-orm/mysql-core";
import { tenants, users } from "./users";

/** Passwords are stored only as an application-generated hash. */
export const passwordCredentials = mysqlTable("password_credentials", {
  userId: char("user_id", { length: 26 }).primaryKey().references(() => users.id, { onDelete: "cascade" }),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  passwordUpdatedAt: datetime("password_updated_at", { mode: "date" }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});

/** One-time verification codes. Their original value is never persisted. */
export const verificationCodes = mysqlTable("verification_codes", {
  id: char("id", { length: 26 }).primaryKey(),
  tenantId: char("tenant_id", { length: 26 }).notNull().references(() => tenants.id),
  phone: varchar("phone", { length: 32 }).notNull(),
  purpose: mysqlEnum("purpose", ["login", "change_phone", "reset_password"]).notNull(),
  codeHash: varchar("code_hash", { length: 255 }).notNull(),
  expiresAt: datetime("expires_at", { mode: "date" }).notNull(),
  consumedAt: datetime("consumed_at", { mode: "date" }),
  attempts: int("attempts").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [index("verification_codes_phone_purpose_idx").on(table.phone, table.purpose, table.createdAt)]);

/** Browser sessions can be revoked individually without changing a password. */
export const sessions = mysqlTable("sessions", {
  id: char("id", { length: 26 }).primaryKey(),
  tenantId: char("tenant_id", { length: 26 }).notNull().references(() => tenants.id),
  userId: char("user_id", { length: 26 }).notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 255 }).notNull().unique(),
  userAgent: varchar("user_agent", { length: 512 }),
  ipHash: varchar("ip_hash", { length: 128 }),
  lastSeenAt: datetime("last_seen_at", { mode: "date" }).notNull(),
  expiresAt: datetime("expires_at", { mode: "date" }).notNull(),
  revokedAt: datetime("revoked_at", { mode: "date" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("sessions_user_active_idx").on(table.userId, table.revokedAt, table.expiresAt),
  index("sessions_tenant_active_idx").on(table.tenantId, table.revokedAt, table.expiresAt),
  index("sessions_expiry_idx").on(table.expiresAt),
]);
