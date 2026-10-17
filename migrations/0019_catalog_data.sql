CREATE TABLE `catalog_products` (
	`id` text PRIMARY KEY NOT NULL,
	`supplier` text NOT NULL,
	`supplier_product_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`category` text NOT NULL,
	`title` text,
	`description` text,
	`images` text DEFAULT '[]' NOT NULL,
	`attributes` text DEFAULT '{}' NOT NULL,
	`details_refreshed_at` integer,
	`refresh_claimed_until` integer,
	`last_refresh_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_products_supplier_unique_idx` ON `catalog_products` (`supplier`,`supplier_product_id`);--> statement-breakpoint
CREATE INDEX `catalog_products_status_idx` ON `catalog_products` (`status`);--> statement-breakpoint
CREATE TABLE `catalog_variant_offers` (
	`variant_id` text NOT NULL,
	`destination_country` text NOT NULL,
	`origin_country` text NOT NULL,
	`logistic_name` text,
	`delivery_days_min` integer,
	`delivery_days_max` integer,
	`supplier_cost_cents` integer NOT NULL,
	`shipping_cents` integer,
	`catalog_price_cents` integer,
	`available` integer NOT NULL,
	`unavailable_reason` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`variant_id`, `destination_country`),
	FOREIGN KEY (`variant_id`) REFERENCES `catalog_variants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `catalog_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`supplier_variant_id` text NOT NULL,
	`sku` text,
	`name` text NOT NULL,
	`options` text DEFAULT '{}' NOT NULL,
	`image_key` text,
	`weight_grams` integer NOT NULL,
	`supplier_cost_cents` integer NOT NULL,
	`stock` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `catalog_products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_variants_supplier_variant_unique_idx` ON `catalog_variants` (`supplier_variant_id`);--> statement-breakpoint
CREATE INDEX `catalog_variants_product_idx` ON `catalog_variants` (`product_id`);