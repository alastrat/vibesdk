CREATE TABLE `template_purchases` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text NOT NULL,
	`user_id` text NOT NULL,
	`price_cents` integer NOT NULL,
	`provider` text NOT NULL,
	`created_at` integer DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`template_id`) REFERENCES `templates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `template_purchases_template_user_unique_idx` ON `template_purchases` (`template_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `template_purchases_user_idx` ON `template_purchases` (`user_id`);--> statement-breakpoint
CREATE TABLE `template_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text NOT NULL,
	`version` integer NOT NULL,
	`source_commit` text NOT NULL,
	`snapshot_key` text NOT NULL,
	`file_count` integer NOT NULL,
	`total_bytes` integer NOT NULL,
	`desktop_shot_key` text NOT NULL,
	`mobile_shot_key` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`rights_confirmed_at` integer NOT NULL,
	`reviewed_by` text,
	`reviewed_at` integer,
	`rejection_reason` text,
	`created_at` integer DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`template_id`) REFERENCES `templates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `template_versions_template_version_unique_idx` ON `template_versions` (`template_id`,`version`);--> statement-breakpoint
CREATE INDEX `template_versions_status_idx` ON `template_versions` (`status`);--> statement-breakpoint
CREATE TABLE `templates` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`creator_user_id` text NOT NULL,
	`source_app_id` text,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`category` text NOT NULL,
	`current_version_id` text,
	`status` text DEFAULT 'unlisted' NOT NULL,
	`price_cents` integer DEFAULT 0 NOT NULL,
	`use_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT CURRENT_TIMESTAMP,
	`updated_at` integer DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`creator_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `templates_slug_unique` ON `templates` (`slug`);--> statement-breakpoint
CREATE INDEX `templates_creator_idx` ON `templates` (`creator_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `templates_source_app_unique_idx` ON `templates` (`source_app_id`);--> statement-breakpoint
CREATE INDEX `templates_status_category_idx` ON `templates` (`status`,`category`);--> statement-breakpoint
ALTER TABLE `apps` ADD `from_template_version_id` text;--> statement-breakpoint
ALTER TABLE `users` ADD `role` text DEFAULT 'user' NOT NULL;
--> statement-breakpoint
UPDATE `users` SET `role` = 'admin' WHERE `email` = 'alastrat@pluriza.com';
