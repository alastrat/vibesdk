import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true });

/** The app's own code: no tests, no declarations. The callers of `loadStripe` are found in it, not named in this test. */
const code = Object.entries(sources).filter(([path]) => !/\.(test|spec|d)\.tsx?$/.test(path));

/** The arguments of every `loadStripe(…)` call in a file, read by matching parentheses. */
function loadStripeArguments(source: string): string[] {
	const found: string[] = [];
	for (const match of source.matchAll(/\bloadStripe\(/g)) {
		let depth = 1;
		let end = match.index + match[0].length;
		while (depth > 0 && end < source.length) {
			if (source[end] === '(') depth++;
			if (source[end] === ')') depth--;
			end++;
		}
		found.push(source.slice(match.index + match[0].length, end - 1).trim());
	}
	return found;
}

const callers = code.filter(([path, source]) => path !== '/src/lib/stripe/stripe-js.ts' && loadStripeArguments(source).length > 0);

describe("Stripe's card form speaks the app's language", () => {
	it('is opened by the checkout, the card page and the bank confirmation, and by nothing else', () => {
		expect(callers.map(([path]) => path).sort()).toEqual(['/src/hooks/use-billing-card.ts', '/src/hooks/use-billing-checkout.ts', '/src/lib/stripe/next-action.ts']);
	});

	it.each(callers)('is opened with the active language by %s', (_path, source) => {
		for (const args of loadStripeArguments(source)) expect(args).toMatch(/,\s*getLocale\(\)$/);
	});

	it('is a language every caller must pass', () => {
		expect(sources['/src/lib/stripe/stripe-js.ts']).toContain('export async function loadStripe(publishableKey: string, locale: Locale): Promise<StripeJs>');
	});
});
