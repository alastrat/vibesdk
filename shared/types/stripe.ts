/** Every Stripe request names its API version, so a new account default can't change what Stripe returns. */
export const STRIPE_API_VERSION = '2026-03-25.dahlia';

/** Stripe.js built for the pinned API version; the checkout pages load it from here. */
export const STRIPE_JS_URL = `https://js.stripe.com/${STRIPE_API_VERSION.split('.')[1]}/stripe.js`;
