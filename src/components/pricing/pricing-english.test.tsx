/** The public pricing page stays in English whatever language the app is in; only the in-app plan button follows it. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { PlanButton } from '@/components/billing/PlanButton';
import { applyAccountLocale, useI18n } from '@/lib/i18n';
import { PlanCards } from './PlanCards';

vi.mock('@/hooks/use-billing', () => ({
	useBillingOn: () => true,
	usePlanCheckout: () => ({ start: () => undefined }),
}));
vi.mock('@/hooks/use-public-plan', () => ({ usePublicPlan: () => ({ data: null }) }));
vi.mock('@/components/public-site/StartBuildingButton', () => ({ StartBuildingButton: () => null }));

afterEach(async () => {
	await applyAccountLocale('en');
});

const sources = import.meta.glob<string>(['/src/components/billing/BillingBanner.tsx', '/src/components/pricing/*.tsx'], { query: '?raw', import: 'default', eager: true });

const markup = (element: ReturnType<typeof createElement>): string => renderToStaticMarkup(createElement(MemoryRouter, null, element));

/** The in-app caller: a component that hands the plan button the language the seller picked. */
function InApp({ plan }: { plan: 'pro' | 'premium' }) {
	return createElement(PlanButton, { plan, i18n: useI18n() });
}

describe('the pricing page', () => {
	it('sells Pro and Premium with English buttons while the app is in Spanish and in Portuguese', async () => {
		for (const locale of ['es', 'pt-BR'] as const) {
			await applyAccountLocale(locale);
			const html = markup(createElement(PlanCards));
			expect(html).toContain('Get Pro');
			expect(html).toContain('Get Premium');
			expect(html).not.toMatch(/Obtener|Assinar/);
		}
	});
});

describe('the plan button in the app', () => {
	it('says "Get Pro" by default, and follows the language it is handed', async () => {
		expect(markup(createElement(PlanButton, { plan: 'pro' }))).toContain('Get Pro');
		await applyAccountLocale('es');
		expect(markup(createElement(InApp, { plan: 'pro' }))).toContain('Obtener Pro');
		await applyAccountLocale('pt-BR');
		expect(markup(createElement(InApp, { plan: 'premium' }))).toContain('Assinar Premium');
	});

	it('is English on a public page even while the app speaks another language', async () => {
		await applyAccountLocale('es');
		expect(markup(createElement(PlanButton, { plan: 'pro' }))).toContain('Get Pro');
	});
});

describe('who hands the plan button a language', () => {
	it('is the billing banner in the app, and none of the public pricing components', () => {
		expect(sources['/src/components/billing/BillingBanner.tsx']).toContain('<PlanButton plan={action.plan} variant="blue" className="px-3 py-1 text-xs" i18n={i18n} />');
		for (const [path, source] of Object.entries(sources)) {
			if (!path.startsWith('/src/components/pricing/') || path.endsWith('.test.tsx') || !source.includes('<PlanButton')) continue;
			expect(source, path).not.toMatch(/<PlanButton[^>]*i18n=/);
		}
	});
});
