ALTER TABLE `store_checkouts` ADD `weighted_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `stripe_connect_accounts` ADD `seller_level` text DEFAULT 'new' NOT NULL;--> statement-breakpoint
ALTER TABLE `stripe_connect_accounts` ADD `payout_delay_days` integer;