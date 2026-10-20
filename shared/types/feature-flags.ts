/**
 * Product rollouts and pauses, evaluated in PostHog (worker/services/posthog/flags.ts). Secrets and infrastructure
 * toggles stay env vars. Every flag defaults off: a flag only ever turns something on or pauses something. PostHog
 * leaves disabled flags out of its answer, so a missing, disabled or errored flag, or a PostHog outage, changes
 * nothing. Pausing means the pause flag at 100%. Pauses are enforced on the server; the browser sees a pause flag
 * only where it hides something.
 */

export type FlagKind = 'rollout' | 'pause';

export interface FlagDefinition {
	description: string;
	kind: FlagKind;
	/** Sent to the browser with the signed-in session; server-only flags never leave the Worker. */
	clientVisible: boolean;
}

export const FEATURE_FLAGS = {
	billing: {
		description: 'Plans, subscriptions and the billing page. Also on with BILLING=on, or for a user in BILLING_USER_IDS.',
		kind: 'rollout',
		clientVisible: true,
	},
	'store-drafts-paused': { description: 'Pauses starting new drafts of a store. Drafts that exist keep working.', kind: 'pause', clientVisible: true },
	'live-store-payments-paused': {
		description: 'Pauses real payments on live stores, which also need LIVE_STORE_PAYMENTS=on.',
		kind: 'pause',
		clientVisible: false,
	},
	'catalog-paused': {
		description: 'Pauses selling catalog products: checkout, the AI catalog tools and the catalog page. Paid orders still go to the supplier.',
		kind: 'pause',
		clientVisible: true,
	},
	'session-replay-paused': { description: 'Pauses session replay in the browser.', kind: 'pause', clientVisible: true },
	'ai-builds-paused': { description: 'Pauses new AI turns everywhere they start. Running turns finish; stores keep working.', kind: 'pause', clientVisible: false },
	'signups-paused': { description: 'Pauses new accounts, by email or a provider. Existing accounts sign in.', kind: 'pause', clientVisible: false },
	'store-publishing-paused': { description: 'Pauses Go live and republishing. Live stores keep serving.', kind: 'pause', clientVisible: true },
	'custom-domains-paused': { description: 'Pauses connecting a new own domain. Connected domains keep working.', kind: 'pause', clientVisible: true },
	'template-sales-paused': { description: 'Pauses buying paid templates. Free templates still work.', kind: 'pause', clientVisible: false },
	'billing-checkout-paused': {
		description: 'Pauses billing checkout, plan changes and credit top-ups. Existing subscriptions keep working.',
		kind: 'pause',
		clientVisible: false,
	},
} as const satisfies Record<string, FlagDefinition>;

export type FlagKey = keyof typeof FEATURE_FLAGS;
export type FlagValues = Record<FlagKey, boolean>;
export type ClientFlagKey = { [K in FlagKey]: (typeof FEATURE_FLAGS)[K]['clientVisible'] extends true ? K : never }[FlagKey];
export type ClientFlagValues = Record<ClientFlagKey, boolean>;

export const FLAG_KEYS = Object.keys(FEATURE_FLAGS) as FlagKey[];

export function isFlagKey(value: string): value is FlagKey {
	return Object.hasOwn(FEATURE_FLAGS, value);
}

/** Every flag off: nothing rolled out, nothing paused. */
export function defaultFlagValues(): FlagValues {
	return Object.fromEntries(FLAG_KEYS.map((key) => [key, false])) as FlagValues;
}

export function clientFlagValues(values: FlagValues): ClientFlagValues {
	const visible = FLAG_KEYS.filter((key): key is ClientFlagKey => FEATURE_FLAGS[key].clientVisible);
	return Object.fromEntries(visible.map((key) => [key, values[key]])) as ClientFlagValues;
}
