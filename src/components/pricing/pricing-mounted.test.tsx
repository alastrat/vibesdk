/** Keeps the calculator mounted while the selected language changes. */
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { act, createElement, Fragment } from 'react';
import type { LinkProps } from 'react-router';
import { applyAccountLocale, t, tn, useI18n } from '@/lib/i18n';
import { publicTranslator } from '@/lib/i18n/public-pricing';
import { PublicFaq } from '@/components/public-site/PublicFaq';
import { pricingFaq } from '@/content/positioning';
import { mountElement, silenceTestRendererDeprecation, textOf, unmountAll } from '@/test-support/mounted';
import { Calculator } from './Calculator';

// Navigation is outside this regression; avoid mixing router contexts with SSR tests in the Workers runtime.
vi.mock('react-router', () => ({
 Link: ({ children, to, ...props }: LinkProps) => createElement('a', { ...props, href: typeof to === 'string' ? to : to.pathname }, children),
}));
vi.mock('@/hooks/use-billing', () => ({
 useBillingOn: () => true,
 usePlanCheckout: () => ({ start: () => undefined }),
}));
vi.mock('@/hooks/use-public-plan', () => ({ usePublicPlan: () => ({ data: null }) }));
vi.mock('@/hooks/use-model-rates', () => {
 const model = { id: 'test-model', label: 'Example Model', creditsPerStep: 1 };
 return { useModelRates: () => ({ models: [model], rates: [1], defaultModel: model }) };
});
vi.mock('@/components/public-site/StartBuildingButton', () => ({ StartBuildingButton: () => null }));

beforeAll(silenceTestRendererDeprecation);
afterEach(async () => {
 await unmountAll();
 await applyAccountLocale('en');
});

function PricingPreview() {
 // Mirrors the locale subscription supplied by localizeRoutes to public route components.
 useI18n();
 return createElement(Fragment, null,
  createElement(Calculator),
  createElement(PublicFaq, { leading: pricingFaq(true, [1], publicTranslator()) }),
 );
}

it('updates an open calculator and FAQ without losing the entered store count', async () => {
 const renderer = await mountElement(createElement(PricingPreview));
 const stores = () => renderer.root.findAllByType('input').find(input => input.props.type === 'number')!;
 await act(async () => stores().props.onChange({ target: { value: '3' } }));
 for (const locale of ['es', 'pt-BR', 'en'] as const) {
  await act(async () => applyAccountLocale(locale));
  expect(stores().props.value).toBe('3');
  const visible = textOf(renderer);
  expect(visible).toContain('Example Model');
  expect(visible).toContain(t('Find the plan that fits your stores'));
  expect(visible).toContain(t('What are AI credits?'));
  expect(visible).toContain(tn('These are typical amounts for {count} store. Adjust anything below to match your plans.', 'These are typical amounts for {count} stores. Adjust anything below to match your plans.', 3));
  if (locale !== 'en') expect(visible).not.toContain('These are typical amounts for');
 }
});
