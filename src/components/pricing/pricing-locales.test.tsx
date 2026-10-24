/** Public prices and wording follow the visitor language while keeping USD and monthly allowances. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { PlanButton } from '@/components/billing/PlanButton';
import { applyAccountLocale, useI18n, t } from '@/lib/i18n';
import { PlanCards } from './PlanCards';
import { ComparePlans } from './ComparePlans';
import { CreditsExplainer } from './CreditsExplainer';
import { useBillingOn } from '@/hooks/use-billing';
import { PLAN_COMPARISON } from '@/lib/plans';
import { marketingCopy } from '@/content/marketing-copy';
import { PublicFaq } from '@/components/public-site/PublicFaq';
import { pricingFaq } from '@/content/positioning';
import { formatUsd, formatCredits, publicTranslator } from '@/lib/i18n/public-pricing';

vi.mock('@/hooks/use-billing', () => ({
	useBillingOn: vi.fn(() => true),
	usePlanCheckout: () => ({ start: () => undefined }),
}));
vi.mock('@/hooks/use-model-rates', () => {
 const model = { id: 'test-model', label: 'Example Model', creditsPerStep: 1 };
 return { useModelRates: () => ({ models: [model], rates: [1], defaultModel: model }) };
});
vi.mock('@/hooks/use-public-plan', () => ({ usePublicPlan: () => ({ data: null }) }));
vi.mock('@/components/public-site/StartBuildingButton', () => ({ StartBuildingButton: () => null }));

afterEach(async () => {
	await applyAccountLocale('en');
	vi.mocked(useBillingOn).mockReturnValue(true);
});

const sources = import.meta.glob<string>(['/src/components/billing/BillingBanner.tsx', '/src/components/pricing/*.tsx'], { query: '?raw', import: 'default', eager: true });

const markup = (element: ReturnType<typeof createElement>): string => renderToStaticMarkup(createElement(MemoryRouter, null, element));

/** The in-app caller: a component that hands the plan button the language the seller picked. */
function InApp({ plan }: { plan: 'pro' | 'premium' }) {
	return createElement(PlanButton, { plan, i18n: useI18n() });
}

describe('the pricing page', () => {
	it('compares three plans and gives every benefit an accessible help control', () => {
		const html = markup(createElement(ComparePlans, { billing: false }));
		const header = html.slice(html.indexOf('<thead>'), html.indexOf('</thead>'));
		expect(header).toContain('Basic');
		expect(header).toContain('Pro');
		expect(header).toContain('Premium');
		expect(header).not.toMatch(/Enterprise|Custom/);
		expect(header).not.toMatch(/Coming soon/i);
		expect(html).toContain('5,000/mo');
		const builder = html.slice(html.indexOf('<tbody'), html.indexOf('</tbody>'));
		const benefitLabels = [...builder.matchAll(/aria-label="About ([^"]+)"/g)].map((match) => match[1]);
		expect(benefitLabels.slice(0, 2)).toEqual(['Create and launch stores', 'AI credits']);
		const featureCount = PLAN_COMPARISON.reduce((total, section) => total + section.rows.length, 0);
		expect(html.match(/aria-label="About /g)).toHaveLength(featureCount);
		expect(html).toContain(marketingCopy.pricing.comparison.features.aiCredits.label);
	});

	it('explains concrete credit uses and marks unimplemented image and analysis tools as coming soon', () => {
		const html = markup(createElement(CreditsExplainer));
		const cards = html.match(/<li\b[\s\S]*?<\/li>/g) ?? [];
		expect(cards).toHaveLength(8);
		for (const card of cards) expect(card).toContain('<svg');
		expect(cards[3]).not.toContain('<a ');
		for (const title of ['Create product images', 'Research products and trends', 'Improve your store with data']) {
			const card = cards.find(card => card.includes(title));
			expect(card, title).toBeDefined();
			expect(card, title).toContain('Coming soon');
		}
		expect(cards.find(card => card.includes('Write product copy and blog posts'))).not.toContain('Coming soon');
		expect(html).not.toContain('Personalize shopping');
		expect(html).not.toMatch(/credits per|AI steps per/);
		expect(html).toContain('href="/pricing/calculator"');
	});

	it('presents Premium without a launch badge while online checkout is unavailable', () => {
		vi.mocked(useBillingOn).mockReturnValue(false);
		const html = markup(createElement(PlanCards));
		const premium = html.slice(html.indexOf('Premium'), html.lastIndexOf('</article>'));
		expect(premium).toContain('Contact us to activate Premium.');
		expect(html).toContain('5,000 AI credits a month');
		expect(premium).not.toContain('Paid plans are coming soon');
		expect(premium.slice(0, premium.indexOf('</h3>') + 200)).not.toMatch(/Coming soon/i);
	});

	it('sells Pro and Premium in Spanish and Portuguese when those languages are selected', async () => {
		for (const locale of ['es', 'pt-BR'] as const) {
			await applyAccountLocale(locale);
			const html = markup(createElement(PlanCards));
			expect(html).toContain(locale === 'es' ? 'Obtener Pro' : 'Assinar Pro');
			expect(html).toContain(locale === 'es' ? 'Obtener Premium' : 'Assinar Premium');
			expect(html).not.toMatch(/Get Pro|Get Premium/);
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

	it('retains English for an explicit caller that does not pass a translator', async () => {
		await applyAccountLocale('es');
		expect(markup(createElement(PlanButton, { plan: 'pro' }))).toContain('Get Pro');
	});
});

describe('who hands the plan button a language', () => {
	it('is both the billing banner and every public pricing checkout', () => {
		expect(sources['/src/components/billing/BillingBanner.tsx']).toContain('<PlanButton plan={action.plan} variant="blue" className="px-3 py-1 text-xs" i18n={i18n} />');
		for (const [path, source] of Object.entries(sources)) {
			if (!path.startsWith('/src/components/pricing/') || path.endsWith('.test.tsx') || !source.includes('<PlanButton')) continue;
			expect(source, path).toMatch(/<PlanButton[^>]*i18n=/);
		}
	});
});

it('shows monthly equivalents and the full annual charge when yearly is selected, keeping credits monthly', () => {
 const html = markup(createElement(PlanCards, { interval: 'year' }));
 expect(html).toContain('$39');
 expect(html).toContain('$159');
 expect(html).toContain('$468 billed yearly');
 expect(html).toContain('$1,908 billed yearly');
 expect(html).toContain('20,000 AI credits a month');
 expect(html).toContain('Save 20%');
 const comparison = markup(createElement(ComparePlans, { billing: true, interval: 'year' }));
 expect(comparison).toContain('$39/mo');
 expect(comparison).toContain('$468 billed yearly');
});

it('replaces allowance descriptions with paid-only credit dropdowns and computes selected totals', () => {
 const html = markup(createElement(PlanCards, { interval:'year', credits:{pro:30000,premium:200000} }));
 expect(html.match(/role="combobox"/g)).toHaveLength(2);
 expect(html).toContain('Pro monthly AI credits');
 expect(html).toContain('Premium monthly AI credits');
 expect(html).toContain('$51');
 expect(html).toContain('$612 billed yearly');
 expect(html).toContain('$279');
 expect(html).toContain('$3,348 billed yearly');
 for (const plan of ['basic','pro','premium'] as const) expect(html).not.toContain(marketingCopy.pricing.plans[plan].benefit);
 const comparison = markup(createElement(ComparePlans,{billing:true,interval:'month',credits:{pro:30000,premium:200000}}));
 expect(comparison).toContain('$64/mo');
 expect(comparison).toContain('30,000/mo');
});


it('includes supplier products and automatic fulfillment on Basic, inherited by paid plans', () => {
 const html = markup(createElement(PlanCards));
 const basic = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/)?.[1];
 expect(basic).toContain(marketingCopy.pricing.comparison.features.catalog.label);
 expect(basic).toContain(marketingCopy.pricing.comparison.features.fulfillment.label);
 expect(html).not.toContain('The supplier catalog');
});


for (const locale of ['es', 'pt-BR'] as const) {
 it(`keeps annual charges and monthly allowances in USD in ${locale}`, async () => {
  await applyAccountLocale(locale);
  const html = markup(createElement(PlanCards, { interval: 'year', credits: { pro: 30000, premium: 200000 } }));
  const annual = t(marketingCopy.pricing.billing.yearlyNote, { amount: formatUsd(61200) });
  const allowance = t('{credits} AI credits a month', { credits: formatCredits(30000) });
  expect(annual).not.toContain('billed yearly');
  expect(allowance).not.toContain('AI credits a month');
  expect(html).toContain(annual);
  expect(html).toContain(allowance);
  expect(html).toContain(formatUsd(5100));
  expect(html).toContain(formatUsd(334800));
  expect(html).toContain(locale === 'es' ? 'USD' : 'US$');
  expect(html).not.toContain('R$');
  const comparison = markup(createElement(ComparePlans, { billing: true, interval: 'year', credits: { pro: 30000, premium: 200000 } }));
  expect(comparison).toContain(annual);
  expect(comparison).toContain(t('{amount}/mo', { amount: formatCredits(30000) }));
 });

 it(`renders the FAQ and numeric credit explanations in ${locale}`, async () => {
  await applyAccountLocale(locale);
  const html = markup(createElement(PublicFaq, { leading: pricingFaq(true, [1, 2], publicTranslator()) }));
  for (const english of ['What are AI credits?', 'Can I buy more credits?', 'Is Estori free?']) {
   expect(t(english)).not.toBe(english);
   expect(html).toContain(t(english));
   expect(html).not.toContain(english);
  }
  expect(html).toContain(locale === 'es' ? 'USD' : 'US$');
  expect(html).not.toContain('Yes, on every plan at the same price');
 });
}
