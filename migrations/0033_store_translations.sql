CREATE TABLE `store_texts` (
	`app_id` text NOT NULL,
	`source_hash` text NOT NULL,
	`source_text` text NOT NULL,
	`kind` text NOT NULL,
	`seen_at` integer NOT NULL,
	PRIMARY KEY(`app_id`, `source_hash`),
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `store_texts_app_seen_idx` ON `store_texts` (`app_id`,`seen_at`);--> statement-breakpoint
CREATE TABLE `store_translation_settings` (
	`app_id` text PRIMARY KEY NOT NULL,
	`source_locale` text NOT NULL,
	`targets` text DEFAULT '{}' NOT NULL,
	`match_browser` integer DEFAULT true NOT NULL,
	`show_switcher` integer DEFAULT true NOT NULL,
	`auto_translate` integer DEFAULT true NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`extracted_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `store_translations` (
	`app_id` text NOT NULL,
	`locale` text NOT NULL,
	`source_hash` text NOT NULL,
	`source_text` text NOT NULL,
	`text` text NOT NULL,
	`origin` text NOT NULL,
	`machine_text` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`app_id`, `locale`, `source_hash`),
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade
);
