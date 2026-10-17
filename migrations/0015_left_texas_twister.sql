CREATE TABLE `contact_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`email` text NOT NULL,
	`company` text NOT NULL,
	`company_size` text NOT NULL,
	`topic` text NOT NULL,
	`message` text,
	`premium_credits` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `contact_requests_created_at_idx` ON `contact_requests` (`created_at`);