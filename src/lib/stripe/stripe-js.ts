import { STRIPE_JS_URL } from '../../../shared/types/stripe';

/** Appearance for Elements. Only the theme and the variables Estori sets are typed. */
export interface StripeAppearance {
	theme: 'stripe' | 'night';
	variables: {
		colorPrimary: string;
		colorBackground: string;
		colorText: string;
		colorDanger: string;
		fontFamily: string;
		borderRadius: string;
	};
}

/** The slice of a Checkout Session that Stripe.js passes to `change` handlers. */
export interface StripeCheckoutSession {
	canConfirm: boolean;
	status: { type: 'open' | 'expired' | 'complete' };
	/** Stripe.js refuses to confirm unless the page has read the total, so a page reads it from here. */
	total: { total: { amount: string; minorUnitsAmount: number } };
}

/** `code` is `null` unless Stripe names the failure, for example `invalidCode` or `paymentFailed`. */
export interface StripeCheckoutActionError {
	message: string;
	code: string | null;
}

export type StripeCheckoutActionResult =
	| { type: 'success'; session: StripeCheckoutSession }
	| { type: 'error'; error: StripeCheckoutActionError };

export interface StripeCheckoutActions {
	/** Pays or saves the card, then Stripe sends the buyer to the session's `return_url`. */
	confirm(): Promise<StripeCheckoutActionResult>;
	applyPromotionCode(code: string): Promise<StripeCheckoutActionResult>;
	removePromotionCode(): Promise<StripeCheckoutActionResult>;
	/** The session as it stands, for a first read of the total before any `change` event. */
	getSession(): StripeCheckoutSession;
}

export type StripeCheckoutLoadActionsResult =
	| { type: 'success'; actions: StripeCheckoutActions }
	| { type: 'error'; error: StripeCheckoutActionError };

export interface StripePaymentElementChange {
	/** True when every field is filled in and well formed. */
	complete: boolean;
	empty: boolean;
}

export interface StripePaymentElement {
	mount(target: string | HTMLElement): void;
	unmount(): void;
	destroy(): void;
	on(event: 'change', handler: (change: StripePaymentElementChange) => void): void;
}

export interface StripeCheckoutSdkOptions {
	clientSecret: string;
	elementsOptions: { appearance: StripeAppearance };
}

export interface StripeCheckoutSdk {
	on(event: 'change', handler: (session: StripeCheckoutSession) => void): void;
	loadActions(): Promise<StripeCheckoutLoadActionsResult>;
	createPaymentElement(): StripePaymentElement;
	/** Re-applies the look to the mounted elements, for a theme switch. */
	changeAppearance(appearance: StripeAppearance): void;
}

export interface StripeNextActionError {
	message?: string;
	code?: string;
}

/** Either the intent after the buyer's authentication, or the reason it failed. */
export type StripeNextActionResult =
	| { paymentIntent: { status: string }; error?: undefined }
	| { paymentIntent?: undefined; error: StripeNextActionError };

export interface StripeJs {
	initCheckoutElementsSdk(options: StripeCheckoutSdkOptions): StripeCheckoutSdk;
	handleNextAction(options: { clientSecret: string }): Promise<StripeNextActionResult>;
}

type StripeFactory = (publishableKey: string) => StripeJs;

declare global {
	interface Window {
		Stripe?: StripeFactory;
	}
}

const STRIPE_LOAD_ERROR_MESSAGE = 'Stripe could not load';

let scriptLoad: Promise<StripeFactory> | null = null;

function loadScript(): Promise<StripeFactory> {
	if (window.Stripe) return Promise.resolve(window.Stripe);
	if (scriptLoad) return scriptLoad;
	const load = new Promise<StripeFactory>((resolve, reject) => {
		const script = document.querySelector<HTMLScriptElement>(`script[src="${STRIPE_JS_URL}"]`) ?? document.createElement('script');
		const fail = () => {
			script.remove();
			scriptLoad = null;
			reject(new Error(STRIPE_LOAD_ERROR_MESSAGE));
		};
		script.addEventListener('load', () => (window.Stripe ? resolve(window.Stripe) : fail()), { once: true });
		script.addEventListener('error', fail, { once: true });
		if (!script.isConnected) {
			script.src = STRIPE_JS_URL;
			script.async = true;
			document.head.append(script);
		}
	});
	scriptLoad = load;
	return load;
}

/**
 * Adds Stripe.js to the page once, then returns a new Stripe instance for the key. Each Checkout
 * Session gets its own instance, because Stripe.js can't confirm a second session on the same one.
 */
export async function loadStripe(publishableKey: string): Promise<StripeJs> {
	const factory = await loadScript();
	return factory(publishableKey);
}
