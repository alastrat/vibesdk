/**
 * The billing page's wording in Spanish and Portuguese: what each plan choice, confirmation, notice and status says, with
 * dates and amounts written the way the language writes them, and the messages the page compares with the server's.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { CHECKOUT_EXPIRED_MESSAGE, PLAN_LIMITS, type BillingView, type PlanId } from '@/api-types';
import { historyRowsFor } from '@/components/billing/history-rows';
import { upgradeActionFor, upgradeTitleFor } from '@/components/billing/upgrade-action';
import { applyAccountLocale, t } from '@/lib/i18n';
import es from '../../../shared/i18n/catalogs/es.json';
import ptBR from '../../../shared/i18n/catalogs/pt-BR.json';
import { translatorFor } from '../../../shared/i18n/translate';
import { subscriptionConsentText } from '../../../shared/types/billing';
import {
	CARD_SAVED_MESSAGE,
	billingBannerFor,
	cardLabelFor,
	confirmationFor,
	creditsSummaryFor,
	describePaymentResult,
	pastDueActionsFor,
	paymentNoteFor,
	planChoicesFor,
	planStatusFor,
	purchaseLineFor,
	renewalLineFor,
} from './billing-view';
import { saveLabelFor } from './card-state';
import { consentPartsOf, dueTodayLabel, isExpiredRefusal } from './checkout-state';

const NOV_5 = Date.UTC(2026, 10, 5, 10);

function view(plan: PlanId, overrides: Partial<BillingView> = {}): BillingView {
	return {
		enabled: true,
		plan,
		source: plan === 'basic' ? 'free' : 'subscription',
		status: plan === 'basic' ? null : 'active',
		periodStart: Date.UTC(2026, 9, 5, 10),
		periodEnd: NOV_5,
		cancelAtPeriodEnd: false,
		pendingPlan: null,
		pendingPlanAt: null,
		graceEndsAt: null,
		paymentFailing: false,
		credits: { pool: PLAN_LIMITS[plan].aiCredits, granted: 0, used: 0, left: PLAN_LIMITS[plan].aiCredits, purchasedLeft: 0, available: PLAN_LIMITS[plan].aiCredits, renewsAt: NOV_5 },
		alert: null,
		purchases: [],
		limits: PLAN_LIMITS[plan],
		canManageBilling: plan !== 'basic',
		canBuyCredits: plan === 'premium',
		card: null,
		...overrides,
	};
}

/** `Intl` writes a no-break space between a currency and its amount, and in some dates; the tests read it as a space. */
const plain = (text: string | null): string => (text ?? '').replace(/[  ]/g, ' ');

afterEach(async () => {
	await applyAccountLocale('en');
});

describe('plan choices and confirmations', () => {
	it('words the choices of each plan in Spanish', async () => {
		await applyAccountLocale('es');
		expect(planChoicesFor(view('basic')).map((choice) => choice.label)).toEqual(['Obtener Pro', 'Obtener Premium']);
		const pro = planChoicesFor(view('pro'));
		expect(pro.map((choice) => choice.label)).toEqual(['Tu plan', 'Cambiar a Premium']);
		const ending = planChoicesFor(view('pro', { cancelAtPeriodEnd: true }));
		expect(ending.map((choice) => [choice.label, choice.note])).toEqual([
			['Mantener Pro', 'Termina el 5 de noviembre'],
			['Mantén Pro primero', null],
		]);
		expect(planChoicesFor(view('premium')).map((choice) => choice.label)).toEqual(['Cambiar a Pro en la renovación', 'Tu plan']);
		expect(planChoicesFor(view('premium', { source: 'override' })).map((choice) => [choice.label, choice.note])).toEqual([
			['Definido por Estori', 'Habla con nosotros para cambiar tu plan.'],
			['Definido por Estori', 'Habla con nosotros para cambiar tu plan.'],
		]);
	});

	it('words them in Portuguese, with the plan name where the grammar wants it', async () => {
		await applyAccountLocale('pt-BR');
		expect(planChoicesFor(view('basic')).map((choice) => choice.label)).toEqual(['Assinar Pro', 'Assinar Premium']);
		const moving = planChoicesFor(view('pro', { pendingPlan: 'premium', pendingPlanAt: NOV_5 }));
		expect(moving.map((choice) => [choice.label, choice.note])).toEqual([
			['Manter Pro', 'Muda para Premium em 5 de novembro'],
			['Começa em 5 de novembro', null],
		]);
	});

	it('says what a change charges or ends before the seller confirms it', async () => {
		await applyAccountLocale('es');
		expect(plain(confirmationFor(view('pro'), 'upgrade').body)).toBe(
			'Tendrás 100,000 créditos de IA al mes de inmediato, y los créditos que ya usaste este mes se descuentan de ellos. Cobraremos la diferencia por el resto de este mes y después Premium se renueva por USD 199 al mes.',
		);
		expect(confirmationFor(view('premium'), 'downgrade').title).toBe('¿Quieres cambiar a Pro en la renovación?');
		expect(confirmationFor(view('pro'), 'cancel')).toEqual({
			title: '¿Quieres cancelar Pro?',
			body: 'Pro sigue activo hasta el 5 de noviembre; después tu cuenta pasa a Basic. Tus tiendas siguen publicadas.',
			confirm: 'Cancelar Pro',
		});
		await applyAccountLocale('pt-BR');
		expect(confirmationFor(view('pro'), 'cancel')).toEqual({
			title: 'Deseja cancelar Pro?',
			body: 'O plano Pro continua ativo até 5 de novembro e, depois, sua conta passa para o Basic. Suas lojas continuam no ar.',
			confirm: 'Cancelar Pro',
		});
		expect(plain(confirmationFor(view('premium'), 'downgrade').body)).toBe(
			'Você mantém o plano Premium até 5 de novembro. Depois, o plano Pro é renovado por US$ 49 por mês, com 20.000 créditos de IA por mês. Não há reembolso pelo restante deste mês.',
		);
	});
});

describe('status, renewal and credits', () => {
	it('words the status badge in each language, as one word that fits', async () => {
		const statuses = (): string[] => [view('basic'), view('pro'), view('pro', { cancelAtPeriodEnd: true }), view('pro', { paymentFailing: true }), view('pro', { source: 'override' })].map(planStatusFor);
		expect(statuses()).toEqual(['Free', 'Active', 'Ending', 'Payment failing', 'Set by Estori']);
		await applyAccountLocale('es');
		expect(statuses()).toEqual(['Gratis', 'Activo', 'Finaliza pronto', 'Pago fallido', 'Definido por Estori']);
		await applyAccountLocale('pt-BR');
		expect(statuses()).toEqual(['Grátis', 'Ativo', 'Termina em breve', 'Pagamento com falha', 'Definido pelo Estori']);
	});

	it('words the renewal line with the date the way the language writes it', async () => {
		await applyAccountLocale('es');
		expect(renewalLineFor(view('pro'))).toBe('Se renueva el 5 de noviembre');
		expect(renewalLineFor(view('basic'))).toBe('Los créditos de IA se renuevan el 5 de noviembre');
		await applyAccountLocale('pt-BR');
		expect(renewalLineFor(view('pro'))).toBe('Renova em 5 de novembro');
		expect(renewalLineFor(view('pro', { cancelAtPeriodEnd: true }))).toBe('Termina em 5 de novembro');
	});

	it('words the meter and what covered a month that ran over', async () => {
		const over = view('pro', { credits: { pool: 20_000, granted: 0, used: 20_500, left: 0, purchasedLeft: 4_500, available: 4_500, renewsAt: NOV_5 }, purchases: [{ credits: 5_000, left: 4_500, purchasedAt: 1, expiresAt: Date.UTC(2027, 9, 19) }] });
		await applyAccountLocale('es');
		expect(creditsSummaryFor(over)).toMatchObject({
			meterLabel: '20,000 de 20,000 créditos de IA usados este mes',
			overrunNote: 'Tus créditos adicionales cubrieron los otros 500.',
		});
		await applyAccountLocale('pt-BR');
		expect(creditsSummaryFor(over)).toMatchObject({
			meterLabel: '20.000 de 20.000 créditos de IA usados neste mês',
			overrunNote: 'Seus créditos extras cobriram os outros 500.',
		});
		const unfinished = view('pro', { credits: { pool: 20_000, granted: 0, used: 20_300, left: 0, purchasedLeft: 0, available: 0, renewsAt: NOV_5 } });
		expect(creditsSummaryFor(unfinished)?.overrunNote).toBe('Foram usados mais 300 para concluir turnos que já estavam em andamento.');
	});

	it('words an extra-credits purchase with its expiry date', async () => {
		const purchase = { credits: 5_000, left: 5_000, purchasedAt: 1, expiresAt: Date.UTC(2027, 9, 19, 10) };
		expect(purchaseLineFor(purchase)).toBe('5,000 left, expire October 19, 2027');
		await applyAccountLocale('es');
		expect(purchaseLineFor(purchase)).toBe('5,000 restantes, vencen el 19 de octubre de 2027');
		await applyAccountLocale('pt-BR');
		expect(purchaseLineFor(purchase)).toBe('5.000 restantes, expiram em 19 de outubro de 2027');
	});
});

describe('a failed payment', () => {
	const failing = view('pro', { paymentFailing: true, graceEndsAt: NOV_5, card: { brand: 'visa', last4: '4242', expMonth: 8, expYear: 2028 } });

	it('words the note, the banner and the ways out in Spanish', async () => {
		await applyAccountLocale('es');
		expect(paymentNoteFor(failing)).toBe(
			"Tu último pago no se completó. Las funciones de Pro siguen activas hasta el 5 de noviembre, y los créditos de IA de este mes empiezan cuando se complete el pago.",
		);
		expect(billingBannerFor(failing)).toEqual({
			tone: 'warning',
			message: 'Tu último pago no se completó. Actualiza tu tarjeta antes del 5 de noviembre para conservar Pro.',
			action: { kind: 'link', to: '/settings/billing', label: 'Abrir facturación' },
		});
		expect(pastDueActionsFor(failing)).toEqual({ payNow: 'Pagar ahora con Visa terminada en 4242', updateCard: { label: 'Actualizar tarjeta y pagar', to: '/settings/billing/card?mode=pay' } });
		expect(cardLabelFor({ brand: 'visa', last4: '4242', expMonth: 8, expYear: 2028 })).toBe('Visa terminada en 4242, vence el 08/28');
		expect(cardLabelFor({ brand: 'unknown', last4: '4242', expMonth: 8, expYear: 2028 })).toBe('Tarjeta terminada en 4242, vence el 08/28');
	});

	it('words them in Portuguese', async () => {
		await applyAccountLocale('pt-BR');
		expect(billingBannerFor(failing)?.message).toBe('Seu último pagamento não foi concluído. Atualize seu cartão até 5 de novembro para manter o plano Pro.');
		expect(pastDueActionsFor(failing)?.payNow).toBe('Pagar agora com Visa com final 4242');
		expect(cardLabelFor({ brand: 'mastercard', last4: '0005', expMonth: 1, expYear: 2030 })).toBe('Mastercard com final 0005, vence em 01/30');
	});

	it('words the credits-left banner', async () => {
		const low = view('pro', { alert: 'credits_20', credits: { pool: 20_000, granted: 0, used: 16_000, left: 4_000, purchasedLeft: 0, available: 4_000, renewsAt: NOV_5 } });
		await applyAccountLocale('es');
		expect(billingBannerFor(low)?.message).toBe('Te quedan 4,000 créditos de IA hasta el 5 de noviembre.');
		await applyAccountLocale('pt-BR');
		expect(billingBannerFor(low)?.message).toBe('Você tem 4.000 créditos de IA restantes até 5 de novembro.');
	});

	it('words what a payment came to, and shows the card save', async () => {
		await applyAccountLocale('es');
		expect(describePaymentResult({ state: 'paid' })).toEqual({ tone: 'success', message: 'Tu pago se completó.' });
		expect(describePaymentResult({ state: 'saved' }).message).toBe(t(CARD_SAVED_MESSAGE));
		expect(describePaymentResult({ state: 'declined', message: '' }).message).toBe('El pago no se completó. Prueba con otra tarjeta.');
		expect(saveLabelFor('pay')).toBe('Guardar tarjeta y pagar');
		await applyAccountLocale('pt-BR');
		expect(saveLabelFor('save')).toBe('Salvar cartão');
	});
});

describe('the checkout page', () => {
	it('links the word for the Terms in a consent sentence worded in the same language, and says they are in English', async () => {
		const consent = (translator: ReturnType<typeof translatorFor>) => subscriptionConsentText('pro', null, translator);
		await applyAccountLocale('es');
		const spanish = consentPartsOf(consent(translatorFor(es, 'es')));
		expect(spanish).toMatchObject({ before: 'Acepto los ', link: 'Términos' });
		expect(spanish.after.startsWith(' (en inglés) y que Estori Pro')).toBe(true);
		await applyAccountLocale('pt-BR');
		const portuguese = consentPartsOf(consent(translatorFor(ptBR, 'pt-BR')));
		expect(portuguese).toMatchObject({ before: 'Concordo com os ', link: 'Termos' });
		expect(portuguese.after.startsWith(' (em inglês) e com o fato de que o Estori Pro')).toBe(true);
	});

	it('still links the Terms in a sentence the server worded in English', async () => {
		await applyAccountLocale('es');
		expect(consentPartsOf('I agree to the Terms, and that Estori Pro renews at $49 a month until I cancel.')).toMatchObject({ before: 'I agree to the ', link: 'Terms' });
		expect(consentPartsOf('Sin enlace')).toEqual({ before: 'Sin enlace', link: null, after: '' });
	});

	it('knows the timed-out answer whatever language the server gave it in', async () => {
		const timedOut = (message: string) => isExpiredRefusal(Object.assign(new Error(message), { status: 400 }));
		for (const locale of ['en', 'es', 'pt-BR'] as const) {
			await applyAccountLocale(locale);
			expect(timedOut(t(CHECKOUT_EXPIRED_MESSAGE))).toBe(true);
		}
		expect(timedOut('El tiempo para finalizar esta compra se agotó.')).toBe(false);
		await applyAccountLocale('es');
		expect(timedOut('El tiempo para finalizar esta compra se agotó.')).toBe(true);
		expect(timedOut('Otra cosa')).toBe(false);
		expect(isExpiredRefusal(Object.assign(new Error(CHECKOUT_EXPIRED_MESSAGE), { status: 409 }))).toBe(false);
	});

	it('writes what is due today in the language', async () => {
		expect(dueTodayLabel(null, 4_900)).toBe('$49');
		await applyAccountLocale('es');
		expect(plain(dueTodayLabel(null, 4_900))).toBe('USD 49');
		expect(dueTodayLabel('USD 24,50', 4_900)).toBe('USD 24,50');
		await applyAccountLocale('pt-BR');
		expect(plain(dueTodayLabel(null, 4_900))).toBe('US$ 49');
	});
});

describe('the invoice history and the Upgrade dialog', () => {
	const OCT_20 = Date.UTC(2026, 9, 20, 10);
	const invoice = (status: 'paid' | 'open' | 'void' | 'uncollectible', currency = 'usd') => ({ id: status, date: OCT_20, description: 'Estori Pro', amountCents: 4_900, currency, status });

	it('words the status, the date and the amount of each invoice in each language', async () => {
		await applyAccountLocale('es');
		const spanish = historyRowsFor([invoice('paid'), invoice('open'), invoice('void'), invoice('uncollectible', 'eur')]);
		expect(spanish.map((row) => row.status.label)).toEqual(['Pagada', 'Pago pendiente', 'Anulada', 'No cobrada']);
		expect(spanish.map((row) => [plain(row.date), plain(row.amount)])).toEqual([
			['20 oct 2026', 'USD 49'],
			['20 oct 2026', 'USD 49'],
			['20 oct 2026', 'USD 49'],
			['20 oct 2026', 'EUR 49'],
		]);
		await applyAccountLocale('pt-BR');
		const portuguese = historyRowsFor([invoice('paid'), invoice('open')]);
		expect(portuguese.map((row) => row.status.label)).toEqual(['Paga', 'Pagamento pendente']);
		expect(portuguese.map((row) => [plain(row.date), plain(row.amount)])).toEqual([
			['20 de out. de 2026', 'US$ 49'],
			['20 de out. de 2026', 'US$ 49'],
		]);
	});

	it('words the title and the next step for a plan limit', async () => {
		const refusal = { code: 'plan_limit' as const, limit: 'liveStores' as const, plan: 'basic' as const, upgradeTo: 'pro' as const, message: '' };
		await applyAccountLocale('es');
		expect(upgradeTitleFor(refusal)).toBe('Llegaste a tu límite de tiendas publicadas');
		expect(upgradeActionFor(refusal)).toEqual({ kind: 'checkout', plan: 'pro', label: 'Obtener Pro' });
		expect(upgradeTitleFor({ ...refusal, paymentFailed: true })).toBe('Tu pago no se completó');
		await applyAccountLocale('pt-BR');
		expect(upgradeTitleFor({ ...refusal, limit: 'aiCredits' })).toBe('Seus créditos de IA acabaram');
		expect(upgradeActionFor({ ...refusal, plan: 'premium', limit: 'aiCredits', upgradeTo: 'credits' })).toMatchObject({ label: 'Comprar créditos' });
	});
});
