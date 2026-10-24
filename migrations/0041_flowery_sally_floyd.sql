DROP INDEX `account_products_import_unique`;--> statement-breakpoint
CREATE INDEX `account_products_source_idx` ON `account_products` (`owner_id`,`source_catalog_product_id`);