import type { SellerAccountCosts } from '@/api-types';
import { INTL_LOCALE, type Locale } from 'shared/i18n/locales';
import { interpolate, type Translator } from 'shared/i18n/translate';

function money(cents: number, locale: Locale): string {
	return locale === 'en' && cents < 100 ? `${cents}\u00a2` : new Intl.NumberFormat(INTL_LOCALE[locale], { style: 'currency', currency: 'USD' }).format(cents / 100).replace(/\u00a0/g, ' ');
}

/** Stripe's account and payout fees in words, for a seller with no sales to estimate from yet. */
export function stripeFeesText(costs: SellerAccountCosts, locale: Locale = 'en', t: Translator['t'] = interpolate): string {
	return t('{monthly} a month in Stripe fees, plus {percent}% and {fixed} per payout, once you\'re paid', { monthly: money(costs.monthlyActiveCents, locale), percent: costs.payoutPercent.toLocaleString(INTL_LOCALE[locale]), fixed: money(costs.payoutFixedCents, locale) });
}
