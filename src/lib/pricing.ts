import { TEMPLATE_PRICE_OPTIONS_CENTS, platformFeeCents } from '@/api-types';

export function formatCents(cents: number): string {
	return `$${(cents / 100).toFixed(2)}`;
}

/** The example sale shown on the landing page's creators panel; one of the real price options. */
export const EXAMPLE_SALE_CENTS = 2900;

/** What a seller keeps from a sale after Estori's fee. */
export function sellerKeepsCents(priceCents: number): number {
	return priceCents - platformFeeCents(priceCents);
}

/** What a seller keeps at each paid price option, after Estori's fee. */
export function sellerKeepsTable(): Array<{ priceCents: number; feeCents: number; sellerCents: number }> {
	return TEMPLATE_PRICE_OPTIONS_CENTS.filter((price) => price > 0).map((priceCents) => {
		return { priceCents, feeCents: platformFeeCents(priceCents), sellerCents: sellerKeepsCents(priceCents) };
	});
}
