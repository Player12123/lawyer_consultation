CREATE TABLE `prompt_versions` (
	`id` char(26) NOT NULL,
	`tenant_id` char(26) NOT NULL,
	`prompt_key` varchar(80) NOT NULL,
	`version` int unsigned NOT NULL,
	`status` enum('draft','active','archived') NOT NULL DEFAULT 'draft',
	`content` text NOT NULL,
	`content_hash` char(64) NOT NULL,
	`change_note` varchar(500),
	`created_by_user_id` char(26),
	`activated_at` datetime,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `prompt_versions_id` PRIMARY KEY(`id`),
	CONSTRAINT `prompt_versions_tenant_key_version_unique` UNIQUE(`tenant_id`,`prompt_key`,`version`)
);
--> statement-breakpoint
CREATE TABLE `consultation_contexts` (
	`id` char(26) NOT NULL,
	`tenant_id` char(26) NOT NULL,
	`user_id` char(26) NOT NULL,
	`status` enum('active','closed') NOT NULL DEFAULT 'active',
	`case_state` json,
	`started_at` datetime NOT NULL,
	`closed_at` datetime,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `consultation_contexts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `consultation_entries` (
	`id` char(26) NOT NULL,
	`tenant_id` char(26) NOT NULL,
	`context_id` char(26) NOT NULL,
	`user_id` char(26) NOT NULL,
	`group_id` char(26),
	`client_request_id` char(36) NOT NULL,
	`sequence_no` int unsigned NOT NULL,
	`question_ciphertext` text NOT NULL,
	`answer_ciphertext` text,
	`business_type` varchar(80) NOT NULL,
	`classification_source` enum('rule','inherited','fallback') NOT NULL,
	`route` enum('advice','law','case','clarify') NOT NULL,
	`matched_laws` json,
	`matched_cases` json,
	`prompt_version_id` char(26),
	`status` enum('processing','answered','failed') NOT NULL DEFAULT 'processing',
	`error_code` varchar(80),
	`asked_at` datetime NOT NULL,
	`answered_at` datetime,
	`content_expires_at` datetime NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `consultation_entries_id` PRIMARY KEY(`id`),
	CONSTRAINT `consultation_entries_request_unique` UNIQUE(`tenant_id`,`user_id`,`client_request_id`),
	CONSTRAINT `consultation_entries_context_sequence_unique` UNIQUE(`context_id`,`sequence_no`)
);
--> statement-breakpoint
CREATE TABLE `service_error_logs` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`tenant_id` char(26),
	`user_id` char(26),
	`request_id` char(26),
	`component` varchar(80) NOT NULL,
	`error_code` varchar(80) NOT NULL,
	`message` varchar(1000) NOT NULL,
	`metadata` json,
	`occurred_at` datetime NOT NULL,
	`expires_at` datetime NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `service_error_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tenant_system_admins` (
	`tenant_id` char(26) NOT NULL,
	`user_id` char(26) NOT NULL,
	`assigned_at` datetime NOT NULL,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tenant_system_admins_tenant_id` PRIMARY KEY(`tenant_id`),
	CONSTRAINT `tenant_system_admins_user_unique` UNIQUE(`user_id`)
);
--> statement-breakpoint
CREATE TABLE `user_groups` (
	`id` char(26) NOT NULL,
	`tenant_id` char(26) NOT NULL,
	`name` varchar(80) NOT NULL,
	`status` enum('active','disabled') NOT NULL DEFAULT 'active',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_groups_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_groups_tenant_name_unique` UNIQUE(`tenant_id`,`name`)
);
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `role` enum('agent','group_admin','system_admin','enterprise_user','enterprise_admin') NOT NULL DEFAULT 'agent';--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `status` enum('active','disabled','deleted') NOT NULL DEFAULT 'active';--> statement-breakpoint
ALTER TABLE `users` ADD `group_id` char(26);--> statement-breakpoint
ALTER TABLE `users` ADD `deleted_at` datetime;--> statement-breakpoint
UPDATE `users` SET `role` = 'agent' WHERE `tenant_id` = '01J00000000000000000000000' AND `role` = 'system_admin' AND `id` <> '01J00000000000000000000003';--> statement-breakpoint
INSERT INTO `tenant_system_admins` (`tenant_id`, `user_id`, `assigned_at`)
SELECT `tenant_id`, `id`, NOW() FROM `users` WHERE `role` = 'system_admin';--> statement-breakpoint
ALTER TABLE `users` ADD `system_admin_tenant_guard` char(26)
GENERATED ALWAYS AS (CASE WHEN `role` = 'system_admin' THEN `tenant_id` ELSE NULL END) STORED;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_one_system_admin_per_tenant_unique` UNIQUE (`system_admin_tenant_guard`);--> statement-breakpoint
ALTER TABLE `prompt_versions` ADD CONSTRAINT `prompt_versions_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `prompt_versions` ADD CONSTRAINT `prompt_versions_created_by_user_id_users_id_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `consultation_contexts` ADD CONSTRAINT `consultation_contexts_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `consultation_contexts` ADD CONSTRAINT `consultation_contexts_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `consultation_entries` ADD CONSTRAINT `consultation_entries_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `consultation_entries` ADD CONSTRAINT `consultation_entries_context_id_consultation_contexts_id_fk` FOREIGN KEY (`context_id`) REFERENCES `consultation_contexts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `consultation_entries` ADD CONSTRAINT `consultation_entries_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `consultation_entries` ADD CONSTRAINT `consultation_entries_group_id_user_groups_id_fk` FOREIGN KEY (`group_id`) REFERENCES `user_groups`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `consultation_entries` ADD CONSTRAINT `consultation_entries_prompt_version_id_prompt_versions_id_fk` FOREIGN KEY (`prompt_version_id`) REFERENCES `prompt_versions`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `service_error_logs` ADD CONSTRAINT `service_error_logs_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `service_error_logs` ADD CONSTRAINT `service_error_logs_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tenant_system_admins` ADD CONSTRAINT `tenant_system_admins_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tenant_system_admins` ADD CONSTRAINT `tenant_system_admins_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_groups` ADD CONSTRAINT `user_groups_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `prompt_versions_active_idx` ON `prompt_versions` (`tenant_id`,`prompt_key`,`status`);--> statement-breakpoint
CREATE INDEX `consultation_contexts_user_status_idx` ON `consultation_contexts` (`tenant_id`,`user_id`,`status`,`started_at`);--> statement-breakpoint
CREATE INDEX `consultation_entries_user_time_idx` ON `consultation_entries` (`tenant_id`,`user_id`,`asked_at`);--> statement-breakpoint
CREATE INDEX `consultation_entries_group_type_time_idx` ON `consultation_entries` (`tenant_id`,`group_id`,`business_type`,`asked_at`);--> statement-breakpoint
CREATE INDEX `consultation_entries_content_expiry_idx` ON `consultation_entries` (`content_expires_at`);--> statement-breakpoint
CREATE INDEX `service_error_logs_expiry_idx` ON `service_error_logs` (`expires_at`);--> statement-breakpoint
CREATE INDEX `service_error_logs_component_time_idx` ON `service_error_logs` (`component`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `service_error_logs_request_idx` ON `service_error_logs` (`request_id`);--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_group_id_user_groups_id_fk` FOREIGN KEY (`group_id`) REFERENCES `user_groups`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `users_tenant_group_status_idx` ON `users` (`tenant_id`,`group_id`,`status`);
