import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/worker/api/controllers/publishing/controller.ts'], { query: '?raw', import: 'default', eager: true });
const controller = sources['/worker/api/controllers/publishing/controller.ts'] ?? '';

describe('buying a paid template while template sales are paused', () => {
	it('is refused before Stripe is asked anything', () => {
		const start = controller.indexOf('static async purchase(');
		const purchase = controller.slice(start, controller.indexOf('\n    static ', start + 1));
		const pause = purchase.indexOf("await isFlagOn(env, 'template-sales-paused', context.user?.id ?? null)");
		expect(pause).toBeGreaterThan(-1);
		expect(purchase).toContain('createErrorResponse<SiteCheckoutData>(TEMPLATE_SALES_PAUSED_MESSAGE, 503)');
		for (const later of ['stripeFromEnv(env)', 'readySellerAccount(', 'createCheckoutSession(']) expect(purchase.indexOf(later), later).toBeGreaterThan(pause);
	});

	it('leaves free templates and confirming a finished purchase alone', () => {
		expect(controller.match(/template-sales-paused/g)).toHaveLength(1);
	});
});
