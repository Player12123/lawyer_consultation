CREATE TABLE `active_consultation_contexts` (
	`tenant_id` char(26) NOT NULL,
	`user_id` char(26) NOT NULL,
	`context_id` char(26) NOT NULL,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `active_consultation_contexts_tenant_id_user_id_pk` PRIMARY KEY(`tenant_id`,`user_id`),
	CONSTRAINT `active_consultation_contexts_context_unique` UNIQUE(`context_id`)
);
--> statement-breakpoint
INSERT INTO `active_consultation_contexts` (`tenant_id`, `user_id`, `context_id`)
SELECT `tenant_id`, `user_id`, SUBSTRING_INDEX(GROUP_CONCAT(`id` ORDER BY `started_at` DESC), ',', 1)
FROM `consultation_contexts` WHERE `status` = 'active' GROUP BY `tenant_id`, `user_id`;--> statement-breakpoint
UPDATE `consultation_contexts` cc
LEFT JOIN `active_consultation_contexts` acc ON acc.`context_id` = cc.`id`
SET cc.`status` = 'closed', cc.`closed_at` = COALESCE(cc.`closed_at`, NOW())
WHERE cc.`status` = 'active' AND acc.`context_id` IS NULL;--> statement-breakpoint
ALTER TABLE `active_consultation_contexts` ADD CONSTRAINT `active_consultation_contexts_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `active_consultation_contexts` ADD CONSTRAINT `active_consultation_contexts_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `active_consultation_contexts` ADD CONSTRAINT `acc_context_id_fk` FOREIGN KEY (`context_id`) REFERENCES `consultation_contexts`(`id`) ON DELETE cascade ON UPDATE no action;
