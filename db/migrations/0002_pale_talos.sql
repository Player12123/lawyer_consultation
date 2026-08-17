CREATE TABLE `tenants` (
	`id` char(26) NOT NULL,
	`name` varchar(120) NOT NULL,
	`status` enum('active','disabled') NOT NULL DEFAULT 'active',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tenants_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` DROP INDEX `users_phone_unique`;--> statement-breakpoint
DROP INDEX `users_role_status_idx` ON `users`;--> statement-breakpoint
INSERT INTO `tenants` (`id`, `name`, `status`) VALUES ('01J00000000000000000000000', '历史数据默认租户', 'active');--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `role` enum('user','admin','agent','system_admin','enterprise_user','enterprise_admin') NOT NULL DEFAULT 'agent';--> statement-breakpoint
UPDATE `users` SET `role` = CASE `role` WHEN 'admin' THEN 'system_admin' ELSE 'agent' END;--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `role` enum('agent','system_admin','enterprise_user','enterprise_admin') NOT NULL DEFAULT 'agent';--> statement-breakpoint
ALTER TABLE `sessions` ADD `tenant_id` char(26);--> statement-breakpoint
ALTER TABLE `verification_codes` ADD `tenant_id` char(26);--> statement-breakpoint
ALTER TABLE `audit_events` ADD `tenant_id` char(26);--> statement-breakpoint
ALTER TABLE `users` ADD `tenant_id` char(26);--> statement-breakpoint
UPDATE `users` SET `tenant_id` = '01J00000000000000000000000' WHERE `tenant_id` IS NULL;--> statement-breakpoint
UPDATE `sessions` s JOIN `users` u ON u.`id` = s.`user_id` SET s.`tenant_id` = u.`tenant_id` WHERE s.`tenant_id` IS NULL;--> statement-breakpoint
UPDATE `audit_events` a LEFT JOIN `users` u ON u.`id` = a.`actor_user_id` SET a.`tenant_id` = COALESCE(u.`tenant_id`, '01J00000000000000000000000') WHERE a.`tenant_id` IS NULL;--> statement-breakpoint
UPDATE `verification_codes` v JOIN `users` u ON u.`phone` = v.`phone` SET v.`tenant_id` = u.`tenant_id` WHERE v.`tenant_id` IS NULL;--> statement-breakpoint
UPDATE `verification_codes` SET `tenant_id` = '01J00000000000000000000000' WHERE `tenant_id` IS NULL;--> statement-breakpoint
ALTER TABLE `sessions` MODIFY `tenant_id` char(26) NOT NULL;--> statement-breakpoint
ALTER TABLE `verification_codes` MODIFY `tenant_id` char(26) NOT NULL;--> statement-breakpoint
ALTER TABLE `audit_events` MODIFY `tenant_id` char(26) NOT NULL;--> statement-breakpoint
ALTER TABLE `users` MODIFY `tenant_id` char(26) NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_tenant_phone_unique` UNIQUE(`tenant_id`,`phone`);--> statement-breakpoint
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `verification_codes` ADD CONSTRAINT `verification_codes_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `audit_events` ADD CONSTRAINT `audit_events_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `sessions_tenant_active_idx` ON `sessions` (`tenant_id`,`revoked_at`,`expires_at`);--> statement-breakpoint
CREATE INDEX `audit_events_tenant_time_idx` ON `audit_events` (`tenant_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `users_tenant_role_status_idx` ON `users` (`tenant_id`,`role`,`status`);
