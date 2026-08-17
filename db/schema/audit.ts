import { bigint, char, datetime, index, json, mysqlTable, timestamp, varchar } from "drizzle-orm/mysql-core";
import { tenants, users } from "./users";

/** Append-only security and administrative events; consultation text does not belong here. */
export const auditEvents = mysqlTable("audit_events", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  tenantId: char("tenant_id", { length: 26 }).notNull().references(() => tenants.id),
  actorUserId: char("actor_user_id", { length: 26 }).references(() => users.id, { onDelete: "set null" }),
  eventType: varchar("event_type", { length: 80 }).notNull(),
  targetType: varchar("target_type", { length: 80 }),
  targetId: varchar("target_id", { length: 80 }),
  requestId: char("request_id", { length: 26 }),
  ipHash: varchar("ip_hash", { length: 128 }),
  metadata: json("metadata"),
  occurredAt: datetime("occurred_at", { mode: "date" }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("audit_events_actor_time_idx").on(table.actorUserId, table.occurredAt),
  index("audit_events_tenant_time_idx").on(table.tenantId, table.occurredAt),
  index("audit_events_type_time_idx").on(table.eventType, table.occurredAt),
  index("audit_events_target_idx").on(table.targetType, table.targetId),
]);
