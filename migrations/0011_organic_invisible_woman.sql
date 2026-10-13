CREATE TABLE `site_pages` (
	`app_id` text PRIMARY KEY NOT NULL,
	`copy` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `template_versions` ADD `page_copy` text;