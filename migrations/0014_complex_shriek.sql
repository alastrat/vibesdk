CREATE TABLE `early_access_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`capability` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `early_access_requests_user_capability_idx` ON `early_access_requests` (`user_id`,`capability`);--> statement-breakpoint
CREATE INDEX `early_access_requests_capability_idx` ON `early_access_requests` (`capability`);