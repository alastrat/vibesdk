DROP INDEX `store_orders_seller_idx`;--> statement-breakpoint
ALTER TABLE `store_orders` ADD `shipped_at` integer;--> statement-breakpoint
CREATE INDEX `store_orders_seller_created_idx` ON `store_orders` (`seller_user_id`,`created_at`);