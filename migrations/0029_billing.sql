CREATE TABLE `account_store_counts` (
	`user_id` text PRIMARY KEY NOT NULL,
	`stores_started` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `billing_customers` (
	`user_id` text PRIMARY KEY NOT NULL,
	`stripe_customer_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_customers_stripe_customer_unique_idx` ON `billing_customers` (`stripe_customer_id`);--> statement-breakpoint
CREATE TABLE `billing_events` (
	`stripe_event_id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`object_id` text,
	`user_id` text,
	`result` text NOT NULL,
	`received_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `billing_notices` (
	`user_id` text NOT NULL,
	`notice_key` text NOT NULL,
	`kind` text NOT NULL,
	`sent_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `notice_key`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `credit_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`credits` integer NOT NULL,
	`period_key` text NOT NULL,
	`admin_user_id` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `credit_grants_user_period_idx` ON `credit_grants` (`user_id`,`period_key`);--> statement-breakpoint
CREATE TABLE `credit_periods` (
	`user_id` text NOT NULL,
	`period_key` text NOT NULL,
	`period_start` integer NOT NULL,
	`period_end` integer NOT NULL,
	`pool` integer NOT NULL,
	`granted` integer DEFAULT 0 NOT NULL,
	`used` integer DEFAULT 0 NOT NULL,
	`settled` integer DEFAULT 0 NOT NULL,
	`forgiven` integer DEFAULT 0 NOT NULL,
	`closed_at` integer,
	PRIMARY KEY(`user_id`, `period_key`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `credit_periods_close_idx` ON `credit_periods` (`closed_at`,`period_end`);--> statement-breakpoint
CREATE TABLE `credit_purchases` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`credits` integer NOT NULL,
	`amount_cents` integer NOT NULL,
	`stripe_checkout_session_id` text NOT NULL,
	`stripe_payment_intent_id` text NOT NULL,
	`purchased_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`used` integer DEFAULT 0 NOT NULL,
	`refunded_cents` integer DEFAULT 0 NOT NULL,
	`removed_credits` integer DEFAULT 0 NOT NULL,
	`expired_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credit_purchases_checkout_session_unique_idx` ON `credit_purchases` (`stripe_checkout_session_id`);--> statement-breakpoint
CREATE INDEX `credit_purchases_payment_intent_idx` ON `credit_purchases` (`stripe_payment_intent_id`);--> statement-breakpoint
CREATE INDEX `credit_purchases_user_purchased_idx` ON `credit_purchases` (`user_id`,`purchased_at`);--> statement-breakpoint
CREATE INDEX `credit_purchases_expiry_idx` ON `credit_purchases` (`expired_at`,`expires_at`);--> statement-breakpoint
CREATE TABLE `credit_uses` (
	`use_key` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`period_key` text NOT NULL,
	`credits` integer NOT NULL,
	`source` text NOT NULL,
	`model` text NOT NULL,
	`input_tokens` integer,
	`output_tokens` integer,
	`cache_read_tokens` integer,
	`cache_write_tokens` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `credit_uses_user_created_idx` ON `credit_uses` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `plan_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`plan` text,
	`limits` text DEFAULT '{}' NOT NULL,
	`until` integer,
	`admin_user_id` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `plan_overrides_user_created_idx` ON `plan_overrides` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`user_id` text PRIMARY KEY NOT NULL,
	`stripe_subscription_id` text NOT NULL,
	`status` text NOT NULL,
	`plan` text NOT NULL,
	`current_period_start` integer NOT NULL,
	`current_period_end` integer NOT NULL,
	`cancel_at_period_end` integer DEFAULT false NOT NULL,
	`pending_plan` text,
	`pending_plan_at` integer,
	`stripe_schedule_id` text,
	`stripe_created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscriptions_stripe_subscription_unique_idx` ON `subscriptions` (`stripe_subscription_id`);--> statement-breakpoint
CREATE INDEX `subscriptions_status_idx` ON `subscriptions` (`status`);
--> statement-breakpoint
INSERT INTO `account_store_counts` (`user_id`, `stores_started`, `updated_at`) SELECT `user_id`, COUNT(*), unixepoch() FROM `apps` WHERE `user_id` IS NOT NULL GROUP BY `user_id` ON CONFLICT (`user_id`) DO UPDATE SET `stores_started` = excluded.`stores_started`;
