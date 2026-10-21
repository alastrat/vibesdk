import type { Locale } from '../i18n/locales';

/** Every Stripe request names its API version, so a new account default can't change what Stripe returns. */
export const STRIPE_API_VERSION = '2026-03-25.dahlia';

/** Stripe.js built for the pinned API version; the checkout pages load it from here. */
export const STRIPE_JS_URL = `https://js.stripe.com/${STRIPE_API_VERSION.split('.')[1]}/stripe.js`;

/** The languages of Stripe's own text (the card form, its errors) that match Estori's. */
export type StripeLocale = 'en' | 'es-419' | 'pt-BR';

/** Latin American Spanish, as Estori's Spanish is; Stripe's plain `es` is Spain's. */
export const STRIPE_LOCALES: Record<Locale, StripeLocale> = { en: 'en', es: 'es-419', 'pt-BR': 'pt-BR' };
