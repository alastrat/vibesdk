CREATE TABLE `shopper_email_settings` (
	`app_id` text PRIMARY KEY NOT NULL,
	`reply_to` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `shopper_email_templates` (
	`app_id` text NOT NULL,
	`kind` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`subject` text NOT NULL,
	`heading` text NOT NULL,
	`body` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`app_id`, `kind`),
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `shopper_emails` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`order_id` text NOT NULL,
	`kind` text NOT NULL,
	`event_key` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`test` integer DEFAULT false NOT NULL,
	`recipient` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`message_id` text,
	`error` text,
	`created_at` integer NOT NULL,
	`sent_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shopper_emails_event_unique_idx` ON `shopper_emails` (`order_id`,`kind`,`event_key`);--> statement-breakpoint
CREATE INDEX `shopper_emails_app_created_idx` ON `shopper_emails` (`app_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `shopper_emails_due_idx` ON `shopper_emails` (`status`,`next_attempt_at`);