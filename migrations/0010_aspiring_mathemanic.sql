CREATE TABLE `stripe_connect_accounts` (
	`user_id` text PRIMARY KEY NOT NULL,
	`stripe_account_id` text NOT NULL,
	`details_submitted` integer DEFAULT false NOT NULL,
	`charges_enabled` integer DEFAULT false NOT NULL,
	`payouts_enabled` integer DEFAULT false NOT NULL,
	`transfers_active` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT CURRENT_TIMESTAMP,
	`updated_at` integer DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stripe_connect_accounts_stripe_account_id_unique` ON `stripe_connect_accounts` (`stripe_account_id`);--> statement-breakpoint
ALTER TABLE `template_purchases` ADD `stripe_checkout_session_id` text;--> statement-breakpoint
ALTER TABLE `template_purchases` ADD `stripe_payment_intent_id` text;--> statement-breakpoint
ALTER TABLE `template_purchases` ADD `platform_fee_cents` integer;--> statement-breakpoint
ALTER TABLE `template_purchases` ADD `seller_amount_cents` integer;--> statement-breakpoint
ALTER TABLE `template_purchases` ADD `currency` text DEFAULT 'usd' NOT NULL;--> statement-breakpoint
ALTER TABLE `template_purchases` ADD `seller_stripe_account_id` text;--> statement-breakpoint
ALTER TABLE `template_purchases` ADD `source_app_id` text;--> statement-breakpoint
ALTER TABLE `template_purchases` ADD `version_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `template_purchases_checkout_session_unique_idx` ON `template_purchases` (`stripe_checkout_session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `template_versions_one_pending_idx` ON `template_versions` (`template_id`) WHERE "template_versions"."status" = 'pending';