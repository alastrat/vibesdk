/**
 * One Durable Object per catalog order: it stores the runner's state and runs `runnerStep` on alarms, after the webhook
 * has answered. RPC methods only store state and set the alarm; no supplier call runs inside an RPC.
 */

import { DurableObject } from 'cloudflare:workers';
import { CATALOG_DESTINATIONS } from '../../../shared/types/catalog';
import { createLogger } from '../../logger';
import { CatalogOrderService } from '../../database';
import { isProd } from '../../utils/envs';
import { stripeFromEnv } from '../payments/config';
import { platformAlertsFromEnv } from '../alerts/platform-alerts';
import { CJDropshippingAdapter } from './cj/adapter';
import { cjClientFromEnv } from './cj/client';
import { cjOrderToUpdates } from './cj/updates';
import { catalogRefundRecords } from './refund-records';
import { initialRunnerState, releaseRiskHold, retryRunnerState, runnerStep, type RunnerDeps, type RunnerState } from './runner';
import { sellerNoticesFromEnv } from '../alerts/seller-notices';

const logger = createLogger('CatalogOrderRunner');
const STATE_KEY = 'state';
const ALARM_RETRY_MS = 5 * 60 * 1000;

/** Live supplier orders need production and an explicit switch; everything else is a sandbox order. */
export function catalogSupplierMode(env: Env): 'live' | 'sandbox' {
	return isProd(env) && env.CATALOG_SUPPLIER_LIVE === 'true' ? 'live' : 'sandbox';
}

function runnerDeps(env: Env): RunnerDeps {
	const client = cjClientFromEnv(env);
	const sendAlert = platformAlertsFromEnv(env);
	const alert: RunnerDeps['alert'] = (event) => sendAlert({ kind: event.kind, subject: event.orderId, message: event.message });
	const adapter = client
		? new CJDropshippingAdapter({ client, destinations: CATALOG_DESTINATIONS, mode: catalogSupplierMode(env), alert: (event) => alert({ kind: event.kind, orderId: event.reference, message: event.message }) })
		: { supplier: 'cjdropshipping' as const, placeOrder: async () => ({ ok: false as const, kind: 'retryable' as const, reason: 'The catalog supplier is not configured' }) };
	return {
		store: new CatalogOrderService(env),
		adapters: { cjdropshipping: adapter },
		stripe: stripeFromEnv(env),
		...catalogRefundRecords(env, null),
		supplierUpdates: async (supplierOrderId) => {
			const order = client ? await client.getOrderDetail(supplierOrderId) : null;
			return order ? cjOrderToUpdates(order) : [];
		},
		alert,
		paymentRisk: async (paymentIntentId) => {
			const stripe = stripeFromEnv(env);
			if (!stripe) return 'unknown';
			const charge = (await stripe.retrievePaymentIntent(paymentIntentId)).latest_charge;
			const level = typeof charge === 'object' && charge !== null ? charge.outcome?.risk_level : undefined;
			return level === 'normal' || level === 'elevated' || level === 'highest' ? level : 'unknown';
		},
		notifySeller: sellerNoticesFromEnv(env),
	};
}

export class CatalogOrderRunner extends DurableObject<Env> {
	private async state(): Promise<RunnerState | null> {
		return (await this.ctx.storage.get<RunnerState>(STATE_KEY)) ?? null;
	}

	/** Idempotent: a second start for the same order does nothing. */
	async start(orderId: string): Promise<void> {
		if (await this.state()) return;
		await this.ctx.storage.put(STATE_KEY, initialRunnerState(orderId, Date.now()));
		await this.ctx.storage.setAlarm(Date.now());
	}

	/** Something changed at the supplier: read it now. */
	async signal(): Promise<void> {
		const state = await this.state();
		if (!state) return;
		await this.ctx.storage.put(STATE_KEY, { ...state, nextSyncAt: Date.now() });
		await this.ctx.storage.setAlarm(Date.now());
	}

	/** Admin: one more placement or refund attempt now; starts a runner whose hand-off from checkout was lost. */
	async retry(orderId: string): Promise<void> {
		const state = await this.state();
		if (!state) {
			await this.start(orderId);
			return;
		}
		const now = Date.now();
		await this.ctx.storage.put(STATE_KEY, retryRunnerState(state, now));
		await this.ctx.storage.setAlarm(now);
	}

	/** Admin: place a risk-held order now. */
	async release(): Promise<boolean> {
		const state = await this.state();
		if (!state) return false;
		const now = Date.now();
		const released = releaseRiskHold(state, now);
		// Not held, or the hold's time is up and its expiry decides.
		if (released === state) return false;
		await this.ctx.storage.put(STATE_KEY, released);
		await new CatalogOrderService(this.env).updateOrder(state.orderId, { status: 'awaiting-placement', placementAttempts: 0, lastError: null });
		await this.ctx.storage.setAlarm(now);
		return true;
	}

	async snapshot(): Promise<RunnerState | null> {
		return this.state();
	}

	/** A failed alarm keeps the stored state and tries again later: every step is safe to repeat. */
	async alarm(): Promise<void> {
		const state = await this.state();
		if (!state) return;
		try {
			const result = await runnerStep(state, runnerDeps(this.env), Date.now());
			await this.ctx.storage.put(STATE_KEY, result.state);
			if (result.nextAlarmAt !== null) await this.ctx.storage.setAlarm(result.nextAlarmAt);
		} catch (error) {
			logger.error('Catalog order runner alarm failed; trying again later', { orderId: state.orderId, error });
			await this.ctx.storage.setAlarm(Date.now() + ALARM_RETRY_MS);
		}
	}
}
