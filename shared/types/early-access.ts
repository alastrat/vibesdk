/** Programs that take early-access requests; the API accepts only these ids. */
export const EARLY_ACCESS_CAPABILITIES = ['digital-products', 'content-creators'] as const;

export type EarlyAccessCapability = (typeof EARLY_ACCESS_CAPABILITIES)[number];

export function isEarlyAccessCapability(value: unknown): value is EarlyAccessCapability {
	return typeof value === 'string' && (EARLY_ACCESS_CAPABILITIES as readonly string[]).includes(value);
}
