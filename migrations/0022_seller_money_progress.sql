DROP INDEX `store_refunds_request_line_unique_idx`;--> statement-breakpoint
ALTER TABLE `store_refunds` ADD `stripe_refund_id` text;--> statement-breakpoint
ALTER TABLE `store_refunds` ADD `reversal_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `store_refunds` ADD `reversal_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `store_refunds_order_line_unique_idx` ON `store_refunds` (`order_id`,`line_no`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_seller_charge_collections` (
	`charge_id` text NOT NULL,
	`order_id` text NOT NULL,
	`reversal_id` text,
	`amount_cents` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`charge_id`) REFERENCES `seller_charges`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `store_orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_seller_charge_collections`("charge_id", "order_id", "reversal_id", "amount_cents", "created_at") SELECT "charge_id", "order_id", "reversal_id", "amount_cents", "created_at" FROM `seller_charge_collections`;--> statement-breakpoint
DROP TABLE `seller_charge_collections`;--> statement-breakpoint
ALTER TABLE `__new_seller_charge_collections` RENAME TO `seller_charge_collections`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `seller_charge_collections_unique_idx` ON `seller_charge_collections` (`charge_id`,`order_id`);--> statement-breakpoint
ALTER TABLE `store_disputes` ADD `reversal_state` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `store_fee_adjustments` ADD `difference_cents` integer DEFAULT 0 NOT NULL;