CREATE TABLE `active_prompt_versions` (
	`tenant_id` char(26) NOT NULL,
	`prompt_key` varchar(80) NOT NULL,
	`prompt_version_id` char(26) NOT NULL,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `active_prompt_versions_tenant_id_prompt_key_pk` PRIMARY KEY(`tenant_id`,`prompt_key`),
	CONSTRAINT `active_prompt_versions_version_unique` UNIQUE(`prompt_version_id`)
);
--> statement-breakpoint
ALTER TABLE `active_prompt_versions` ADD CONSTRAINT `active_prompt_versions_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `active_prompt_versions` ADD CONSTRAINT `active_prompt_versions_prompt_version_id_prompt_versions_id_fk` FOREIGN KEY (`prompt_version_id`) REFERENCES `prompt_versions`(`id`) ON DELETE restrict ON UPDATE no action;