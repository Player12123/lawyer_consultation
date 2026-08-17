CREATE TABLE `password_credentials` (
	`user_id` char(26) NOT NULL,
	`password_hash` varchar(255) NOT NULL,
	`password_updated_at` datetime NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `password_credentials_user_id` PRIMARY KEY(`user_id`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` char(26) NOT NULL,
	`user_id` char(26) NOT NULL,
	`token_hash` varchar(255) NOT NULL,
	`user_agent` varchar(512),
	`ip_hash` varchar(128),
	`last_seen_at` datetime NOT NULL,
	`expires_at` datetime NOT NULL,
	`revoked_at` datetime,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `sessions_token_hash_unique` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `verification_codes` (
	`id` char(26) NOT NULL,
	`phone` varchar(32) NOT NULL,
	`purpose` enum('login','change_phone','reset_password') NOT NULL,
	`code_hash` varchar(255) NOT NULL,
	`expires_at` datetime NOT NULL,
	`consumed_at` datetime,
	`attempts` varchar(3) NOT NULL DEFAULT '0',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `verification_codes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`actor_user_id` char(26),
	`event_type` varchar(80) NOT NULL,
	`target_type` varchar(80),
	`target_id` varchar(80),
	`request_id` char(26),
	`ip_hash` varchar(128),
	`metadata` json,
	`occurred_at` datetime NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` char(26) NOT NULL,
	`phone` varchar(32) NOT NULL,
	`display_name` varchar(80) NOT NULL,
	`avatar_url` varchar(512),
	`role` enum('user','admin') NOT NULL DEFAULT 'user',
	`status` enum('active','disabled') NOT NULL DEFAULT 'active',
	`last_login_at` datetime,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_phone_unique` UNIQUE(`phone`)
);
--> statement-breakpoint
ALTER TABLE `password_credentials` ADD CONSTRAINT `password_credentials_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `audit_events` ADD CONSTRAINT `audit_events_actor_user_id_users_id_fk` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `sessions_user_active_idx` ON `sessions` (`user_id`,`revoked_at`,`expires_at`);--> statement-breakpoint
CREATE INDEX `sessions_expiry_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `verification_codes_phone_purpose_idx` ON `verification_codes` (`phone`,`purpose`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_events_actor_time_idx` ON `audit_events` (`actor_user_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `audit_events_type_time_idx` ON `audit_events` (`event_type`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `audit_events_target_idx` ON `audit_events` (`target_type`,`target_id`);--> statement-breakpoint
CREATE INDEX `users_role_status_idx` ON `users` (`role`,`status`);