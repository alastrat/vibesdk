ALTER TABLE `subscriptions` ADD `billing_interval` text DEFAULT 'month' NOT NULL;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `pending_billing_interval` text;