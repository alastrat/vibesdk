CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`app_id` text,
	`kind` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`progress` text DEFAULT '{"done":0,"total":0,"skipped":0}' NOT NULL,
	`credits_used` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`steps` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`pause_reason` text,
	`run_at` integer NOT NULL,
	`lease_until` integer,
	`dedupe_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_unfinished_dedupe_unique_idx` ON `tasks` (`user_id`,`dedupe_key`) WHERE "tasks"."status" IN ('queued', 'running', 'paused');--> statement-breakpoint
CREATE INDEX `tasks_user_status_run_idx` ON `tasks` (`user_id`,`status`,`run_at`);--> statement-breakpoint
CREATE INDEX `tasks_status_run_idx` ON `tasks` (`status`,`run_at`);--> statement-breakpoint
CREATE INDEX `tasks_user_created_idx` ON `tasks` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `tasks_app_idx` ON `tasks` (`app_id`);