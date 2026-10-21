import { afterEach, beforeAll, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { applyAccountLocale, t } from '@/lib/i18n';
import { mountElement, silenceTestRendererDeprecation, textOf, unmountAll } from '@/test-support/mounted';
import { itemsSummary, shippingStatus, PAYMENT_LABELS } from './orders/order-format';
import { STATUS_LABELS, templateOrigin } from './emails/email-format';
import { PageCopySections } from '@/components/site-page/PageCopySections';
import { formatMoney } from '@/lib/paid-listing-display';
beforeAll(silenceTestRendererDeprecation);
afterEach(async () => {
	await unmountAll();
	await applyAccountLocale('en');
});
it('switches page chrome while leaving seller content untouched', async () => {
	const page = await mountElement(createElement(PageCopySections, { copy: null, fallbackDescription: 'My English store story.' }));
	await act(async () => applyAccountLocale('es'));
	expect(textOf(page)).toContain('Acerca de');
	expect(textOf(page)).toContain('My English store story.');
	await act(async () => applyAccountLocale('pt-BR'));
	expect(textOf(page)).toContain('Sobre');
});
it('uses natural item plurals and translated payment and email statuses', async () => {
	await applyAccountLocale('es');
	const row = { units: 1, ownUnits: 0, catalogUnits: 1, fulfillmentStatus: 'unfulfilled' as const, paymentStatus: 'paid' as const };
	expect(itemsSummary(row)).toBe('1 artículo');
	expect(itemsSummary({ ...row, units: 2 })).toBe('2 artículos');
	expect(shippingStatus({ ...row, catalogUnits: 0 })).toBe('Nada por enviar');
	expect(t(PAYMENT_LABELS.partially_refunded)).toBe('Reembolso parcial');
	expect(t(STATUS_LABELS.failed)).toBe('No enviado');
	await applyAccountLocale('pt-BR');
	expect(templateOrigin({ edited: true })).toBe('Editado por você');
	expect(formatMoney(0).replace(/\u00a0/g, ' ')).toBe('US$ 0');
});
