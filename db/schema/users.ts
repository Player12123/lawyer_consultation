import { char, datetime, index, mysqlEnum, mysqlTable, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

export const tenants = mysqlTable("tenants", {
  id: char("id", { length: 26 }).primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  status: mysqlEnum("status", ["active", "disabled"]).notNull().default("active"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});

/** A tenant-scoped work group. Group administrators are users assigned to it. */
export const userGroups = mysqlTable("user_groups", {
  id: char("id", { length: 26 }).primaryKey(),
  tenantId: char("tenant_id", { length: 26 }).notNull().references(() => tenants.id),
  name: varchar("name", { length: 80 }).notNull(),
  status: mysqlEnum("status", ["active", "disabled"]).notNull().default("active"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
}, (table) => [uniqueIndex("user_groups_tenant_name_unique").on(table.tenantId, table.name)]);

/** A person who can use the legal consultation workbench. */
export const users = mysqlTable("users", {
  id: char("id", { length: 26 }).primaryKey(),
  tenantId: char("tenant_id", { length: 26 }).notNull().references(() => tenants.id),
  groupId: char("group_id", { length: 26 }).references(() => userGroups.id),
  phone: varchar("phone", { length: 32 }).notNull(),
  displayName: varchar("display_name", { length: 80 }).notNull(),
  avatarUrl: varchar("avatar_url", { length: 512 }),
  // enterprise_* are retained only for backward compatibility with prior data;
  // new accounts use agent, group_admin, or the single system_admin.
  role: mysqlEnum("role", ["agent", "group_admin", "system_admin", "enterprise_user", "enterprise_admin"]).notNull().default("agent"),
  status: mysqlEnum("status", ["active", "disabled", "deleted"]).notNull().default("active"),
  lastLoginAt: datetime("last_login_at", { mode: "date" }),
  deletedAt: datetime("deleted_at", { mode: "date" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
}, (table) => [
  uniqueIndex("users_tenant_phone_unique").on(table.tenantId, table.phone),
  index("users_tenant_group_status_idx").on(table.tenantId, table.groupId, table.status),
  index("users_tenant_role_status_idx").on(table.tenantId, table.role, table.status),
]);

/** The database-level invariant that a tenant has exactly one designated system administrator. */
export const tenantSystemAdmins = mysqlTable("tenant_system_admins", {
  tenantId: char("tenant_id", { length: 26 }).primaryKey().references(() => tenants.id, { onDelete: "cascade" }),
  userId: char("user_id", { length: 26 }).notNull().references(() => users.id, { onDelete: "restrict" }),
  assignedAt: datetime("assigned_at", { mode: "date" }).notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
}, (table) => [uniqueIndex("tenant_system_admins_user_unique").on(table.userId)]);
