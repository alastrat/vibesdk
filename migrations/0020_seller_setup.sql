ALTER TABLE `stripe_connect_accounts` ADD `card_payments_active` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `seller_terms_version` text;--> statement-breakpoint
ALTER TABLE `users` ADD `seller_terms_accepted_at` integer;