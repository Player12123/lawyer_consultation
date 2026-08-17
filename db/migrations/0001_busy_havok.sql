ALTER TABLE `verification_codes` MODIFY COLUMN `attempts` int NOT NULL;--> statement-breakpoint
ALTER TABLE `verification_codes` MODIFY COLUMN `attempts` int NOT NULL DEFAULT 0;