import { TEMPLATE_PRICE_OPTIONS_CENTS, platformFeeCents } from '@/api-types';

export function formatCents(cents: number): string {
	return `$${(cents / 100).toFixed(2)}`;
}

/** What a seller keeps at each paid price option, after Estori's fee. */
export function sellerKeepsTable(): Array<{ priceCents: number; feeCents: number; sellerCents: number }> {
	return TEMPLATE_PRICE_OPTIONS_CENTS.filter((price) => price > 0).map((priceCents) => {
		const feeCents = platformFeeCents(priceCents);
		return { priceCents, feeCents, sellerCents: priceCents - feeCents };
	});
}
