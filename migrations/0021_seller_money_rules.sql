CREATE TABLE `seller_charge_collections` (
	`charge_id` text NOT NULL,
	`order_id` text NOT NULL,
	`reversal_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`charge_id`) REFERENCES `seller_charges`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `store_orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `seller_charge_collections_unique_idx` ON `seller_charge_collections` (`charge_id`,`order_id`);--> statement-breakpoint
CREATE TABLE `seller_charges` (
	`id` text PRIMARY KEY NOT NULL,
	`seller_user_id` text NOT NULL,
	`kind` text NOT NULL,
	`source_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`collected_cents` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`seller_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `seller_charges_kind_source_unique_idx` ON `seller_charges` (`kind`,`source_id`);--> statement-breakpoint
CREATE INDEX `seller_charges_seller_idx` ON `seller_charges` (`seller_user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `store_disputes` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`reason` text NOT NULL,
	`status` text NOT NULL,
	`reversal_id` text,
	`reversed_cents` integer DEFAULT 0 NOT NULL,
	`fee_cents` integer DEFAULT 0 NOT NULL,
	`returned_cents` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `store_orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `store_fee_adjustments` (
	`order_id` text PRIMARY KEY NOT NULL,
	`collected_cents` integer NOT NULL,
	`actual_fee_cents` integer NOT NULL,
	`reversal_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `store_orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `store_refunds` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`line_no` integer NOT NULL,
	`amount_cents` integer NOT NULL,
	`request_id` text NOT NULL,
	`initiated_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `store_orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `store_refunds_request_line_unique_idx` ON `store_refunds` (`request_id`,`line_no`);--> statement-breakpoint
CREATE INDEX `store_refunds_order_idx` ON `store_refunds` (`order_id`);--> statement-breakpoint
ALTER TABLE `stripe_connect_accounts` ADD `payout_interval` text DEFAULT 'weekly' NOT NULL;--> statement-breakpoint
ALTER TABLE `stripe_connect_accounts` ADD `payout_anchor` text DEFAULT 'monday' NOT NULL;