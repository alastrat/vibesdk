import { expect, it } from 'vitest';
import { billingEmail, type BillingEmail } from '../billing/notices';
import * as emails from './templates';
import { sendSellerNotice, type SellerNoticeDeps } from '../alerts/seller-notices';
import type { Locale } from '../../../shared/i18n/locales';
import type { OutgoingEmail } from './types';
const now = Date.UTC(2026, 10, 5);
const fixtures: BillingEmail[] = [
	{ kind: 'plan_started', plan: 'pro', renewsAt: now },
	{ kind: 'receipt', plan: 'pro', amountCents: 4900, currency: 'usd', periodStart: now, periodEnd: now, invoiceNumber: 'EST-1' },
	{ kind: 'plan_upgraded', plan: 'premium' },
	{ kind: 'downgrade_scheduled', plan: 'pro', at: now },
	{ kind: 'payment_failed', plan: 'pro', graceEndsAt: now, needsConfirmation: true },
	{ kind: 'plan_ending', plan: 'pro', endsAt: now },
	{ kind: 'plan_ended', plan: 'pro', reason: 'cancelled' },
	{ kind: 'credits_renewed', credits: 5000, renewsAt: now },
	{ kind: 'credits_20', plan: 'pro', left: 20, renewsAt: now },
	{ kind: 'credits_5', plan: 'premium', left: 5, renewsAt: now },
	{ kind: 'credits_receipt', credits: 5000, amountCents: 750, expiresAt: Date.UTC(2027, 10, 5), receiptNumber: 'receipt1' },
	{ kind: 'credits_refunded', credits: 5000, amountCents: 750 },
	{ kind: 'enforcement_notice', startsOn: now, overLimits: true },
];
const sellerTemplates: ((locale: Locale) => OutgoingEmail)[] = [
	(locale) => emails.passwordResetEmail('seller@example.test', 'https://estori.test/reset', locale),
	(locale) => emails.verifyEmailEmail('seller@example.test', 'https://estori.test/verify', locale),
	(locale) => emails.sellerLimitReachedEmail('seller@example.test', 50000, locale),
	(locale) => emails.sellerDomainUnreachableEmail('seller@example.test', 'shop.example.test', locale),
	(locale) => emails.sellerItemsRefundedEmail('seller@example.test', 2, 'supplier', locale),
	(locale) =>
		emails.sellerNewOrderEmail(
			'seller@example.test',
			{
				storeTitle: 'My English Store',
				orderNumber: 1,
				test: false,
				totalCents: 1000,
				shareCents: 900,
				items: [{ name: 'English product', quantity: 1, kind: 'own' }],
				shipTo: null,
				note: null,
				link: 'https://estori.test/orders/1',
			},
			locale,
		),
	(locale) =>
		emails.purchaseReceiptEmail(
			'seller@example.test',
			{
				siteTitle: 'English site',
				amountCents: 1000,
				currency: 'usd',
				paidAt: new Date(now),
				receiptNumber: 'r1',
				siteLink: 'https://estori.test/site',
				baseUrl: 'https://estori.test',
			},
			locale,
		),
	(locale) => emails.contactReceivedEmail({ email: 'seller@example.test', topic: 'pro' }, locale),
];
for (const locale of ['es', 'pt-BR'] as const) {
	it(`renders every billing and seller template in ${locale}`, () => {
		const builders = [
			...fixtures.map(
				(fixture) => (selected: Locale) => billingEmail('seller@example.test', fixture, 'https://estori.test', selected),
			),
			...sellerTemplates,
		];
		for (const build of builders) {
			const english = build('en'),
				translated = build(locale);
			expect(translated.subject, english.subject).not.toBe(english.subject);
			expect(translated.html).toContain(`lang="${locale}"`);
			expect(translated.text).toContain(
				locale === 'es' ? 'Enviado a seller@example.test por Estori.' : 'Enviado para seller@example.test pela Estori.',
			);
			expect(translated.html).not.toContain('stripe.com');
			if (translated.html.includes('href=')) expect(translated.html).not.toContain('Or paste this link into your browser:');
		}
	});
}
it('uses the recipient preference for a seller notice', async () => {
	const sent: OutgoingEmail[] = [];
	const deps: SellerNoticeDeps = {
		throttle: { get: async () => null, put: async () => undefined },
		sender: { send: async (email) => void sent.push(email) },
		sellerEmail: async () => 'seller@example.test',
		sellerLocale: async () => 'pt-BR',
	};
	await sendSellerNotice(deps, { sellerUserId: 'seller', kind: 'limit-reached', weeklySalesCents: 50000 });
	expect(sent[0].subject).toBe('Sua loja atingiu o limite semanal de vendas');
});
it('still sends a seller notice in English when the preference is missing or unavailable', async () => {
	for (const sellerLocale of [
		async () => null,
		async () => {
			throw new Error('unavailable');
		},
	]) {
		const sent: OutgoingEmail[] = [];
		const deps: SellerNoticeDeps = {
			throttle: { get: async () => null, put: async () => undefined },
			sender: { send: async (email) => void sent.push(email) },
			sellerEmail: async () => 'seller@example.test',
			sellerLocale,
		};
		expect(await sendSellerNotice(deps, { sellerUserId: 'seller', kind: 'limit-reached', weeklySalesCents: 50000 })).toBe('sent');
		expect(sent[0].subject).toBe(emails.sellerLimitReachedEmail('seller@example.test', 50000).subject);
	}
});
it('formats credit expiry with a localized year, only once', () => {
	const fixture = fixtures.find((email) => email.kind === 'credits_receipt')!;
	const es = billingEmail('seller@example.test', fixture, 'https://estori.test', 'es');
	expect(es.text).toContain('5 de noviembre de 2027');
	expect(es.text).not.toContain('2027, 2027');
});
