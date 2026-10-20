CREATE TABLE `billing_consents` (
	`stripe_checkout_session_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`plan` text NOT NULL,
	`terms_version` text NOT NULL,
	`consent_text` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `billing_consents_user_idx` ON `billing_consents` (`user_id`);