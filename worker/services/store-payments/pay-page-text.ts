/**
 * The words of Estori's checkout page, in the shopper's language. Each is English text the i18n extractor reads, so the
 * catalogs hold its Spanish and Portuguese. Placeholders in the script's messages, such as `{amount}`, are filled by
 * the page when it knows the value.
 */

import type { Locale } from '../../../shared/i18n/locales';
import type { MessageValues } from '../../../shared/i18n/translate';
import { translateFor } from '../../utils/server-translate';

/** The messages the page's own script shows, handed to it with its configuration. */
export interface PayPageScriptText {
	pay: string;
	payAmount: string;
	showSummary: string;
	hideSummary: string;
	free: string;
	removedItem: string;
	variantLine: string;
	oneFewer: string;
	oneMore: string;
	remove: string;
	checkoutFailed: string;
	cannotContinue: string;
	paymentFailed: string;
}

export interface PayPageText {
	title: string;
	checkout: string;
	continueShopping: string;
	contact: string;
	email: string;
	emailPlaceholder: string;
	shippingAddress: string;
	payment: string;
	fine: string;
	orderSummary: string;
	shipTo: string;
	subtotal: string;
	shipping: string;
	total: string;
	orderNote: string;
	cartEmpty: string;
	script: PayPageScriptText;
}

/** The page's words; `brandName` is the store's, or empty for a store with no brand. */
export function payPageText(locale: Locale, brandName: string): PayPageText {
	const t = (english: string, values?: MessageValues): string => translateFor(locale, english, values);
	return {
		title: brandName ? t('Checkout · {brand}', { brand: brandName }) : t('Checkout'),
		checkout: t('Checkout'),
		continueShopping: t('Continue shopping'),
		contact: t('Contact'),
		email: t('Email'),
		emailPlaceholder: t('you@example.com'),
		shippingAddress: t('Shipping address'),
		payment: t('Payment'),
		fine: brandName
			? t('Payments are processed securely by Stripe. {store} is the seller.', { store: brandName })
			: t('Payments are processed securely by Stripe. This store is the seller.'),
		orderSummary: t('Order summary'),
		shipTo: t('Ship to'),
		subtotal: t('Subtotal'),
		shipping: t('Shipping'),
		total: t('Total'),
		orderNote: t('Order note'),
		cartEmpty: t('Your cart is empty'),
		script: {
			pay: t('Pay'),
			payAmount: t('Pay {amount}'),
			showSummary: t('Show order summary'),
			hideSummary: t('Hide order summary'),
			free: t('Free'),
			removedItem: t('An item no longer sold here'),
			variantLine: t('{variant} · {price} each'),
			oneFewer: t('One fewer'),
			oneMore: t('One more'),
			remove: t('Remove'),
			checkoutFailed: t("Checkout couldn't start. Refresh the page and try again."),
			cannotContinue: t("This checkout can't continue. Refresh the page and try again."),
			paymentFailed: t("The payment didn't go through. Check your details and try again."),
		},
	};
}
