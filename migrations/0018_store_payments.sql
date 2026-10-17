CREATE TABLE `store_checkouts` (
	`id` text PRIMARY KEY NOT NULL,
	`mode` text NOT NULL,
	`app_id` text NOT NULL,
	`store_version_id` text,
	`commit_hash` text NOT NULL,
	`seller_user_id` text NOT NULL,
	`seller_stripe_account_id` text,
	`ship_to_country` text NOT NULL,
	`priced_cart` text NOT NULL,
	`subtotal_cents` integer NOT NULL,
	`shipping_cents` integer NOT NULL,
	`total_cents` integer NOT NULL,
	`application_fee_cents` integer NOT NULL,
	`stripe_checkout_session_id` text,
	`status` text DEFAULT 'creating' NOT NULL,
	`success_path` text NOT NULL,
	`cancel_path` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `store_checkouts_session_unique_idx` ON `store_checkouts` (`stripe_checkout_session_id`);--> statement-breakpoint
CREATE INDEX `store_checkouts_app_idx` ON `store_checkouts` (`app_id`);--> statement-breakpoint
CREATE TABLE `store_order_items` (
	`order_id` text NOT NULL,
	`line_no` integer NOT NULL,
	`kind` text NOT NULL,
	`product_id` text NOT NULL,
	`variant_id` text NOT NULL,
	`name` text NOT NULL,
	`quantity` integer NOT NULL,
	`unit_price_cents` integer NOT NULL,
	`catalog_variant_id` text,
	`locked_catalog_price_cents` integer,
	PRIMARY KEY(`order_id`, `line_no`),
	FOREIGN KEY (`order_id`) REFERENCES `store_orders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `store_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`mode` text NOT NULL,
	`app_id` text NOT NULL,
	`order_number` integer NOT NULL,
	`checkout_id` text NOT NULL,
	`seller_user_id` text NOT NULL,
	`seller_stripe_account_id` text,
	`store_version_id` text,
	`stripe_checkout_session_id` text,
	`stripe_payment_intent_id` text,
	`payment_status` text DEFAULT 'paid' NOT NULL,
	`fulfillment_status` text DEFAULT 'unfulfilled' NOT NULL,
	`tracking_number` text,
	`carrier` text,
	`subtotal_cents` integer NOT NULL,
	`shipping_cents` integer NOT NULL,
	`total_cents` integer NOT NULL,
	`application_fee_cents` integer NOT NULL,
	`refunded_cents` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'usd' NOT NULL,
	`customer_email` text,
	`customer_name` text,
	`shipping_address` text,
	`note` text,
	`needs_attention` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `store_orders_checkout_unique_idx` ON `store_orders` (`checkout_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `store_orders_session_unique_idx` ON `store_orders` (`stripe_checkout_session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `store_orders_number_unique_idx` ON `store_orders` (`app_id`,`mode`,`order_number`);--> statement-breakpoint
CREATE INDEX `store_orders_payment_intent_idx` ON `store_orders` (`stripe_payment_intent_id`);--> statement-breakpoint
CREATE INDEX `store_orders_seller_idx` ON `store_orders` (`seller_user_id`);