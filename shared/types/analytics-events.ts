/**
 * Estori's server events: the one list of what the Worker sends to PostHog, with each event's properties. Names are
 * snake_case. Properties never hold an email address or a person's name. Types, not interfaces, so each fits
 * PostHog's JSON properties.
 */

import type { PlanId } from './plans';
import type { SellerLevel } from './seller-levels';
import type { StoreMode } from './store-payments';
import type { TaskKind } from './tasks';

/** The distinct id of events about Estori itself, such as the heartbeat and Worker errors. */
export const SYSTEM_DISTINCT_ID = 'estori-system';
/** The one distinct id of the cost fields still sent for people who turned analytics off; never a person. */
export const OPTED_OUT_DISTINCT_ID = 'opted-out';

export const AMOUNT_BANDS = ['under_25', '25_to_100', '100_to_250', '250_to_1000', '1000_plus'] as const;
export type AmountBand = (typeof AMOUNT_BANDS)[number];

/** A total's band in US dollars; a lower edge belongs to the band above it. */
export function amountBand(cents: number): AmountBand {
	if (cents < 2_500) return 'under_25';
	if (cents < 10_000) return '25_to_100';
	if (cents < 25_000) return '100_to_250';
	if (cents < 100_000) return '250_to_1000';
	return '1000_plus';
}

export type SignInMethod = 'password' | 'google' | 'github' | 'cloudflare';

/** What Estori keeps on each person in PostHog. */
export type PersonProperties = {
	/** The account's plan, as billing resolves it. */
	plan: PlanId;
	seller_level: 'none' | SellerLevel;
	/** YYYY-MM-DD, UTC; set once. */
	signup_date: string;
	has_live_store: boolean;
};

export type ServerEventCatalog = {
	account_created: { method: SignInMethod };
	email_confirmed: Record<string, never>;
	signed_in: { method: SignInMethod };
	build_started: { app_id: string; model: string; first_build: boolean };
	build_finished: {
		app_id: string;
		model: string;
		first_build: boolean;
		outcome: 'completed' | 'failed';
		steps: number;
		/**
		 * The credits billing charged for the turn's steps: real token cost times billing's CREDIT_MARGIN (1.5), at its
		 * CREDIT_USD ($0.001) a credit. Every Think build runs on Estori's gateway, so Estori's cost is
		 * credits_used / 1.5 * $0.001.
		 */
		credits_used: number;
		duration_ms: number;
	};
	task_finished: {
		kind: TaskKind;
		status: 'done' | 'failed' | 'canceled';
		/** Charged like a build's: real token cost times billing's CREDIT_MARGIN, at its CREDIT_USD a credit, on Estori's gateway. */
		credits_used: number;
		steps: number;
	};
	store_published: { app_id: string; first_publish: boolean; draft: 'main' | 'other' };
	store_unpublished: { app_id: string };
	payments_ready: Record<string, never>;
	sale_completed: {
		app_id: string;
		mode: StoreMode;
		total_band: AmountBand;
		application_fee_cents: number;
		has_catalog_items: boolean;
		first_sale: boolean;
	};
	catalog_order_placed: { app_id: string; item_count: number };
	template_sold: { listing_id: string; price_cents: number; platform_fee_cents: number };
	subscription_started: { plan: PlanId };
	subscription_changed: { from_plan: PlanId; to_plan: PlanId; direction: 'up' | 'down' };
	subscription_cancelled: { plan: PlanId; reason: 'seller' | 'payment_failed' | 'admin' };
	subscription_payment_failed: { plan: PlanId; attempt: number };
	credits_purchased: { credits: number; amount_cents: number };
	credits_low: { plan: PlanId; threshold: 20 | 5 };
	credits_limit_reached: { plan: PlanId };
	heartbeat: {
		healthy: boolean;
		app_ok: boolean;
		database_ok: boolean;
		/** Null when no live store exists to check. */
		stores_ok: boolean | null;
		failed: string[];
		duration_ms: number;
	};
};

export type ServerEventName = keyof ServerEventCatalog;
export type ServerEventProperties<N extends ServerEventName> = ServerEventCatalog[N];
export type BillingEventName =
	| 'subscription_started'
	| 'subscription_changed'
	| 'subscription_cancelled'
	| 'subscription_payment_failed'
	| 'credits_purchased'
	| 'credits_low'
	| 'credits_limit_reached';

export interface ServerEventDefinition {
	description: string;
	subject: 'person' | 'system';
	/** Sent without a person when the user turned analytics off, under OPTED_OUT_DISTINCT_ID; every other field is dropped. */
	costFields?: readonly string[];
}

export const SERVER_EVENTS: Readonly<Record<ServerEventName, ServerEventDefinition>> = {
	account_created: { description: 'A password sign-up, or a provider sign-in that creates the account.', subject: 'person' },
	email_confirmed: { description: 'A confirmation link confirmed the account email.', subject: 'person' },
	signed_in: { description: 'A sign-in to an existing account.', subject: 'person' },
	build_started: { description: 'The AI started a turn on a store.', subject: 'person' },
	build_finished: { description: 'An AI turn ended, with its steps and the credits billing charged.', subject: 'person', costFields: ['credits_used'] },
	task_finished: { description: "A seller's background task ended, done, failed or canceled, with its steps and the credits it used.", subject: 'person', costFields: ['credits_used'] },
	store_published: { description: 'A store was published to its live address.', subject: 'person' },
	store_unpublished: { description: 'A live store was taken offline.', subject: 'person' },
	payments_ready: { description: "The seller's Stripe account can take store payments.", subject: 'person' },
	sale_completed: { description: 'A store order was recorded, once per order.', subject: 'person' },
	catalog_order_placed: { description: "A paid order's catalog lines went to the supplier flow.", subject: 'person' },
	template_sold: { description: "A paid site's sale was recorded.", subject: 'person' },
	subscription_started: { description: 'A paid plan began: the subscription was first recorded as live.', subject: 'person' },
	subscription_changed: {
		description: 'The paid plan changed up or down. A downgrade counts when it takes effect at renewal.',
		subject: 'person',
	},
	subscription_cancelled: { description: 'A paid plan ended: cancelled by the seller, after failed payments, or by an admin.', subject: 'person' },
	subscription_payment_failed: { description: 'A renewal payment failed.', subject: 'person' },
	credits_purchased: { description: 'An extra-credits purchase was recorded, once.', subject: 'person' },
	credits_low: { description: 'The credits left fell to 20% or 5%, once per period and threshold.', subject: 'person' },
	credits_limit_reached: { description: 'A turn was refused because no credits were left.', subject: 'person' },
	heartbeat: { description: 'The 15-minute health check of the app, database and stores.', subject: 'system' },
};

export const SERVER_EVENT_NAMES = Object.keys(SERVER_EVENTS) as ServerEventName[];
