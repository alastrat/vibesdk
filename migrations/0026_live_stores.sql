CREATE TABLE `live_stores` (
	`app_id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`status` text DEFAULT 'live' NOT NULL,
	`published_commit` text NOT NULL,
	`published_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `live_stores_slug_unique_idx` ON `live_stores` (`slug`);--> statement-breakpoint
CREATE TABLE `store_domains` (
	`hostname` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`provider` text NOT NULL,
	`provider_id` text,
	`records` text DEFAULT '[]' NOT NULL,
	`last_error` text,
	`created_at` integer NOT NULL,
	`checked_at` integer,
	`verified_at` integer,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `store_domains_app_unique_idx` ON `store_domains` (`app_id`);--> statement-breakpoint
CREATE INDEX `store_domains_status_idx` ON `store_domains` (`status`);