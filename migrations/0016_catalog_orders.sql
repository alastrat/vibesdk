CREATE TABLE `catalog_order_items` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`catalog_variant_id` text NOT NULL,
	`supplier` text NOT NULL,
	`supplier_variant_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`unit_price_cents` integer NOT NULL,
	`catalog_price_cents` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`supplier_order_id` text,
	`tracking_number` text,
	`carrier` text,
	`supplier_refunded` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `catalog_orders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `catalog_order_items_order_idx` ON `catalog_order_items` (`order_id`);--> statement-breakpoint
CREATE INDEX `catalog_order_items_supplier_order_idx` ON `catalog_order_items` (`supplier_order_id`);--> statement-breakpoint
CREATE TABLE `catalog_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`seller_user_id` text NOT NULL,
	`store_app_id` text NOT NULL,
	`stripe_checkout_session_id` text NOT NULL,
	`stripe_payment_intent_id` text NOT NULL,
	`status` text DEFAULT 'awaiting-placement' NOT NULL,
	`total_cents` integer NOT NULL,
	`catalog_total_cents` integer NOT NULL,
	`application_fee_cents` integer NOT NULL,
	`currency` text DEFAULT 'usd' NOT NULL,
	`destination_country` text NOT NULL,
	`shipping_address` text NOT NULL,
	`placement_attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`seller_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_orders_checkout_session_unique_idx` ON `catalog_orders` (`stripe_checkout_session_id`);--> statement-breakpoint
CREATE INDEX `catalog_orders_seller_idx` ON `catalog_orders` (`seller_user_id`);--> statement-breakpoint
CREATE INDEX `catalog_orders_status_idx` ON `catalog_orders` (`status`);