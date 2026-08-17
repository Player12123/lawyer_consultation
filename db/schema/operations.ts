import { bigint, char, datetime, index, json, mysqlTable, timestamp, varchar } from "drizzle-orm/mysql-core";
import { tenants, users } from "./users";

/** Internal, sanitized technical failures. Never exposed in the customer admin UI. */
export const serviceErrorLogs = mysqlTable("service_error_logs", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  tenantId: char("tenant_id", { length: 26 }).references(() => tenants.id, { onDelete: "set null" }),
  userId: char("user_id", { length: 26 }).references(() => users.id, { onDelete: "set null" }),
  requestId: char("request_id", { length: 26 }),
  component: varchar("component", { length: 80 }).notNull(),
  errorCode: varchar("error_code", { length: 80 }).notNull(),
  message: varchar("message", { length: 1000 }).notNull(),
  metadata: json("metadata"),
  occurredAt: datetime("occurred_at", { mode: "date" }).notNull(),
  expiresAt: datetime("expires_at", { mode: "date" }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("service_error_logs_expiry_idx").on(table.expiresAt),
  index("service_error_logs_component_time_idx").on(table.component, table.occurredAt),
  index("service_error_logs_request_idx").on(table.requestId),
]);
