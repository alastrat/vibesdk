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
import { CJDropshippingAdapter } from './cj/adapter';
import { cjClientFromEnv } from './cj/client';
import { cjOrderToUpdates } from './cj/updates';
import { initialRunnerState, runnerStep, type RunnerDeps, type RunnerState } from './runner';

const logger = createLogger('CatalogOrderRunner');
const STATE_KEY = 'state';

/** Live supplier orders need production and an explicit switch; everything else is a sandbox order. */
export function catalogSupplierMode(env: Env): 'live' | 'sandbox' {
	return isProd(env) && env.CATALOG_SUPPLIER_LIVE === 'true' ? 'live' : 'sandbox';
}

function runnerDeps(env: Env): RunnerDeps {
	const client = cjClientFromEnv(env);
	const alert: RunnerDeps['alert'] = async (event) => {
		logger.error('Catalog order needs the owner', event);
	};
	const adapter = client
		? new CJDropshippingAdapter({ client, destinations: CATALOG_DESTINATIONS, mode: catalogSupplierMode(env), alert: (event) => alert({ kind: event.kind, orderId: event.reference, message: event.message }) })
		: { supplier: 'cjdropshipping' as const, placeOrder: async () => ({ ok: false as const, kind: 'retryable' as const, reason: 'The catalog supplier is not configured' }) };
	return {
		store: new CatalogOrderService(env),
		adapters: { cjdropshipping: adapter },
		stripe: stripeFromEnv(env),
		supplierUpdates: async (supplierOrderId) => {
			const order = client ? await client.getOrderDetail(supplierOrderId) : null;
			return order ? cjOrderToUpdates(order) : [];
		},
		alert,
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

	/** Admin: one more placement or refund attempt now. */
	async retry(): Promise<void> {
		const state = await this.state();
		if (!state) return;
		const now = Date.now();
		const placement = state.placement === 'needs-attention' ? 'due' : state.placement;
		await this.ctx.storage.put(STATE_KEY, { ...state, placement, nextPlacementAt: now, refundFailures: 0, nextRefundAt: now, nextSyncAt: state.nextSyncAt ?? now });
		await this.ctx.storage.setAlarm(now);
	}

	async snapshot(): Promise<RunnerState | null> {
		return this.state();
	}

	async alarm(): Promise<void> {
		const state = await this.state();
		if (!state) return;
		const result = await runnerStep(state, runnerDeps(this.env), Date.now());
		await this.ctx.storage.put(STATE_KEY, result.state);
		if (result.nextAlarmAt !== null) await this.ctx.storage.setAlarm(result.nextAlarmAt);
	}
}
