CREATE TABLE `account_products` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`source` text NOT NULL,
	`source_catalog_product_id` text,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`category` text NOT NULL,
	`variants` text NOT NULL,
	`image_asset_id` text,
	`download_asset_ids` text NOT NULL,
	`weight_grams` integer,
	`archived` integer DEFAULT false NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `account_products_owner_idx` ON `account_products` (`owner_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `account_products_import_unique` ON `account_products` (`owner_id`,`source_catalog_product_id`);--> statement-breakpoint
CREATE TABLE `product_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`r2_key` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `product_assets_owner_idx` ON `product_assets` (`owner_id`);--> statement-breakpoint
CREATE TABLE `store_product_listings` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`product_id` text NOT NULL,
	`visibility` text NOT NULL,
	`detached` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `account_products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `store_product_listings_app_product_unique` ON `store_product_listings` (`app_id`,`product_id`);