CREATE TABLE `store_page_events` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`mode` text NOT NULL,
	`visitor_hash` text NOT NULL,
	`path` text NOT NULL,
	`source` text NOT NULL,
	`country` text NOT NULL,
	`device` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `store_page_events_app_mode_created_idx` ON `store_page_events` (`app_id`,`mode`,`created_at`);--> statement-breakpoint
CREATE INDEX `store_page_events_created_idx` ON `store_page_events` (`created_at`);