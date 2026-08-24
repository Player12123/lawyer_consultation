import { char, datetime, index, int, json, mysqlEnum, mysqlTable, primaryKey, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
import { promptVersions } from "./ai";
import { tenants, userGroups, users } from "./users";

/** A continuous context segment. Clearing the UI closes one context and starts another. */
export const consultationContexts = mysqlTable("consultation_contexts", {
  id: char("id", { length: 26 }).primaryKey(),
  tenantId: char("tenant_id", { length: 26 }).notNull().references(() => tenants.id),
  userId: char("user_id", { length: 26 }).notNull().references(() => users.id),
  status: mysqlEnum("status", ["active", "closed"]).notNull().default("active"),
  caseState: json("case_state"),
  startedAt: datetime("started_at", { mode: "date" }).notNull(),
  closedAt: datetime("closed_at", { mode: "date" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("consultation_contexts_user_status_idx").on(table.tenantId, table.userId, table.status, table.startedAt),
]);

/** One authoritative current context per user, independent from retained history. */
export const activeConsultationContexts = mysqlTable("active_consultation_contexts", {
  tenantId: char("tenant_id", { length: 26 }).notNull().references(() => tenants.id, { onDelete: "cascade" }),
  userId: char("user_id", { length: 26 }).notNull().references(() => users.id, { onDelete: "cascade" }),
  contextId: char("context_id", { length: 26 }).notNull().references(() => consultationContexts.id, { onDelete: "cascade" }),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
}, (table) => [
  primaryKey({ columns: [table.tenantId, table.userId] }),
  uniqueIndex("active_consultation_contexts_context_unique").on(table.contextId),
]);

/** One lawyer question, its answer, classification and retrieved legal evidence. */
export const consultationEntries = mysqlTable("consultation_entries", {
  id: char("id", { length: 26 }).primaryKey(),
  tenantId: char("tenant_id", { length: 26 }).notNull().references(() => tenants.id),
  contextId: char("context_id", { length: 26 }).notNull().references(() => consultationContexts.id),
  userId: char("user_id", { length: 26 }).notNull().references(() => users.id),
  groupId: char("group_id", { length: 26 }).references(() => userGroups.id, { onDelete: "set null" }),
  clientRequestId: char("client_request_id", { length: 36 }).notNull(),
  sequenceNo: int("sequence_no", { unsigned: true }).notNull(),
  questionCiphertext: text("question_ciphertext").notNull(),
  answerCiphertext: text("answer_ciphertext"),
  businessType: varchar("business_type", { length: 80 }).notNull(),
  classificationSource: mysqlEnum("classification_source", ["rule", "inherited", "fallback"]).notNull(),
  route: mysqlEnum("route", ["advice", "law", "case", "clarify"]).notNull(),
  matchedLaws: json("matched_laws"),
  matchedCases: json("matched_cases"),
  stageTimings: json("stage_timings"),
  promptVersionId: char("prompt_version_id", { length: 26 }).references(() => promptVersions.id, { onDelete: "set null" }),
  status: mysqlEnum("status", ["processing", "answered", "failed"]).notNull().default("processing"),
  errorCode: varchar("error_code", { length: 80 }),
  askedAt: datetime("asked_at", { mode: "date" }).notNull(),
  answeredAt: datetime("answered_at", { mode: "date" }),
  contentExpiresAt: datetime("content_expires_at", { mode: "date" }).notNull(),
  contentPurgedAt: datetime("content_purged_at", { mode: "date" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("consultation_entries_request_unique").on(table.tenantId, table.userId, table.clientRequestId),
  uniqueIndex("consultation_entries_context_sequence_unique").on(table.contextId, table.sequenceNo),
  index("consultation_entries_user_time_idx").on(table.tenantId, table.userId, table.askedAt),
  index("consultation_entries_group_type_time_idx").on(table.tenantId, table.groupId, table.businessType, table.askedAt),
  index("consultation_entries_content_expiry_idx").on(table.contentExpiresAt),
]);
