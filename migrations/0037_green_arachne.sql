CREATE TABLE `discover_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`version` text NOT NULL,
	`role` text NOT NULL,
	`object_key` text NOT NULL,
	`mime` text NOT NULL,
	`byte_size` integer NOT NULL,
	`sha256` text NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `discover_entries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `discover_assets_entry_version_role_unique` ON `discover_assets` (`entry_id`,`version`,`role`);--> statement-breakpoint
CREATE TABLE `discover_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`color` text NOT NULL,
	`sort_order` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `discover_categories_slug_unique` ON `discover_categories` (`slug`);--> statement-breakpoint
CREATE TABLE `discover_checkout_orders` (
	`entry_id` text NOT NULL,
	`product_name` text NOT NULL,
	`buyer_email` text NOT NULL,
	`return_url` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`version_id` text NOT NULL,
	`price_cents` integer NOT NULL,
	`currency` text NOT NULL,
	`session_id` text,
	`payment_intent_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `discover_entries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`version_id`) REFERENCES `discover_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `discover_checkout_orders_session_id_unique` ON `discover_checkout_orders` (`session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `discover_checkout_orders_payment_intent_id_unique` ON `discover_checkout_orders` (`payment_intent_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `discover_checkout_active_buyer_entry` ON `discover_checkout_orders` (`user_id`,`entry_id`) WHERE "discover_checkout_orders"."status" = 'pending';--> statement-breakpoint
CREATE TABLE `discover_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`description` text NOT NULL,
	`category_id` text NOT NULL,
	`kind` text NOT NULL,
	`tier` text NOT NULL,
	`price_cents` integer NOT NULL,
	`currency` text DEFAULT 'usd' NOT NULL,
	`version` text NOT NULL,
	`tags` text NOT NULL,
	`features` text NOT NULL,
	`palette` text NOT NULL,
	`animation_key` text NOT NULL,
	`featured` integer DEFAULT 0 NOT NULL,
	`published` integer DEFAULT 0 NOT NULL,
	`sort_order` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `discover_categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `discover_entries_slug_unique` ON `discover_entries` (`slug`);--> statement-breakpoint
CREATE INDEX `discover_entries_category_published_idx` ON `discover_entries` (`category_id`,`published`);--> statement-breakpoint
CREATE TABLE `discover_purchases` (
	`entry_id` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`version_id` text NOT NULL,
	`order_id` text NOT NULL,
	`revoked` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `discover_entries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`version_id`) REFERENCES `discover_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `discover_checkout_orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `discover_purchases_order_id_unique` ON `discover_purchases` (`order_id`);--> statement-breakpoint
CREATE INDEX `discover_purchases_user_version_idx` ON `discover_purchases` (`user_id`,`version_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `discover_purchase_active_buyer_entry` ON `discover_purchases` (`user_id`,`entry_id`) WHERE "discover_purchases"."revoked" = 0;--> statement-breakpoint
CREATE TABLE `discover_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`version` text NOT NULL,
	`price_cents` integer NOT NULL,
	`currency` text NOT NULL,
	`source_key` text NOT NULL,
	`download_key` text NOT NULL,
	`source_sha256` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `discover_entries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `discover_versions_entry_version_unique` ON `discover_versions` (`entry_id`,`version`);