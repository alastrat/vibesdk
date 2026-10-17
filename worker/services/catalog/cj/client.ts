/** A minimal CJ API 2.0 client: one request helper, the session's token, spaced calls. Read-only endpoints in this file. */

import { CJ_API_BASE, CJ_MIN_CALL_INTERVAL_MS, CJ_REQUEST_TIMEOUT_MS, CJ_THROTTLED_WAIT_MS } from '../config';
import { CjApiError, classifyCjError } from './errors';
import { CjSession, type CjTokenRecord } from './session';
import type { CjCreatedOrder, CjCreateOrderRequest, CjFreightOption, CjFreightRequest, CjInventory, CjOrderDetail, CjProduct } from './types';

interface CjEnvelope<T> {
	code: number;
	message: string;
	data: T;
	requestId?: string;
	pointsInfo?: { remaining?: number };
}

export interface CjClient {
	queryProduct(pid: string): Promise<CjProduct>;
	inventoryByPid(pid: string): Promise<CjInventory>;
	freightCalculate(input: CjFreightRequest): Promise<CjFreightOption[]>;
	/** The points CJ last reported left today, or null before any call. */
	pointsRemaining(): number | null;
	createOrder(input: CjCreateOrderRequest): Promise<CjCreatedOrder>;
	/** Null when CJ has no order with this id or number. */
	getOrderDetail(orderIdOrNumber: string): Promise<CjOrderDetail | null>;
	/** Moves an order created without payment (CREATED) to UNPAID, ready to pay. */
	confirmOrder(orderId: string): Promise<void>;
	/** Sandbox orders only: pays without touching the balance. */
	simulatePay(orderId: string): Promise<void>;
	/** Live orders only: pays from Estori's CJ balance. */
	payBalance(shipmentOrderId: string): Promise<void>;
	sandboxUpdateStatus(orderId: string, targetStatus: 400 | 500 | 600 | 700): Promise<void>;
	sandboxUpdateTrackNumber(orderId: string, trackNumber: string): Promise<void>;
}

export interface CjClientDeps {
	session: Pick<CjSession, 'token' | 'refresh'>;
	fetchImpl?: typeof fetch;
	sleep?: (ms: number) => Promise<void>;
	now?: () => number;
	minIntervalMs?: number;
}

type CjRequest = { method: 'GET'; query: Record<string, string> } | { method: 'POST' | 'PATCH'; body: unknown };

/** Success is HTTP 200 with code 200; CJ's message must not be used to judge it. */
async function readEnvelope<T>(response: Response): Promise<CjEnvelope<T>> {
	let envelope: CjEnvelope<T> | null;
	try {
		envelope = (await response.json()) as CjEnvelope<T>;
	} catch {
		envelope = null;
	}
	if (response.status !== 200 || !envelope || envelope.code !== 200) {
		throw new CjApiError(envelope?.message ?? `CJ answered HTTP ${response.status}`, response.status, envelope?.code ?? null, envelope?.requestId ?? null);
	}
	return envelope;
}

export async function requestCjAccessToken(apiKey: string, fetchImpl: typeof fetch = fetch): Promise<CjTokenRecord> {
	const response = await fetchImpl(`${CJ_API_BASE}authentication/getAccessToken`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ apiKey }),
		signal: AbortSignal.timeout(CJ_REQUEST_TIMEOUT_MS),
	});
	const { data } = await readEnvelope<{ accessToken: string; accessTokenExpiryDate: string; openId: string | number }>(response);
	return { accessToken: data.accessToken, accessTokenExpiresAt: Date.parse(data.accessTokenExpiryDate), openId: String(data.openId) };
}

export function createCjClient(deps: CjClientDeps): CjClient {
	const fetchImpl = deps.fetchImpl ?? fetch;
	const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
	const now = deps.now ?? (() => Date.now());
	const interval = deps.minIntervalMs ?? CJ_MIN_CALL_INTERVAL_MS;
	let lastCallAt: number | null = null;
	let points: number | null = null;

	async function send<T>(path: string, request: CjRequest, accessToken: string): Promise<T> {
		const wait = lastCallAt === null ? 0 : lastCallAt + interval - now();
		if (wait > 0) await sleep(wait);
		lastCallAt = now();
		const url = request.method === 'GET' ? `${CJ_API_BASE}${path}?${new URLSearchParams(request.query)}` : `${CJ_API_BASE}${path}`;
		const response = await fetchImpl(url, {
			method: request.method,
			headers: { 'Content-Type': 'application/json', 'CJ-Access-Token': accessToken },
			body: request.method === 'GET' ? undefined : JSON.stringify(request.body),
			signal: AbortSignal.timeout(CJ_REQUEST_TIMEOUT_MS),
		});
		const envelope = await readEnvelope<T>(response);
		if (typeof envelope.pointsInfo?.remaining === 'number') points = envelope.pointsInfo.remaining;
		return envelope.data;
	}

	/** An invalid token gets one new token and one repeat; throttling gets one wait and one repeat. */
	async function request<T>(path: string, request: CjRequest): Promise<T> {
		const token = await deps.session.token();
		try {
			return await send<T>(path, request, token.accessToken);
		} catch (error) {
			const kind = classifyCjError(error);
			if (kind === 'auth-token') return send<T>(path, request, (await deps.session.refresh()).accessToken);
			if (kind === 'throttled') {
				await sleep(CJ_THROTTLED_WAIT_MS);
				lastCallAt = now();
				return send<T>(path, request, token.accessToken);
			}
			throw error;
		}
	}

	return {
		queryProduct: (pid) => request<CjProduct>('product/query', { method: 'GET', query: { pid } }),
		inventoryByPid: (pid) => request<CjInventory>('product/stock/getInventoryByPid', { method: 'GET', query: { pid } }),
		freightCalculate: (input) => request<CjFreightOption[]>('logistic/freightCalculate', { method: 'POST', body: input }),
		pointsRemaining: () => points,
		createOrder: (input) => request<CjCreatedOrder>('shopping/order/createOrderV2', { method: 'POST', body: input }),
		getOrderDetail: async (orderIdOrNumber) => {
			try {
				return await request<CjOrderDetail | null>('shopping/order/getOrderDetail', { method: 'GET', query: { orderId: orderIdOrNumber } });
			} catch (error) {
				// CJ answers an unknown order with an error whose message says so.
				if (error instanceof CjApiError && /not (be )?found|not exist/i.test(error.message)) return null;
				throw error;
			}
		},
		confirmOrder: async (orderId) => {
			await request<string>('shopping/order/confirmOrder', { method: 'PATCH', body: { orderId } });
		},
		simulatePay: async (orderId) => {
			await request<boolean>('shopping/sandbox/simulatePay', { method: 'POST', body: { orderId } });
		},
		payBalance: async (shipmentOrderId) => {
			await request<unknown>('shopping/pay/payBalanceV2', { method: 'POST', body: { shipmentOrderId } });
		},
		sandboxUpdateStatus: async (orderId, targetStatus) => {
			await request<boolean>('shopping/sandbox/updateStatus', { method: 'POST', body: { orderId, targetStatus } });
		},
		sandboxUpdateTrackNumber: async (orderId, trackNumber) => {
			await request<boolean>('shopping/sandbox/updateTrackNumber', { method: 'POST', body: { orderId, trackNumber } });
		},
	};
}

/** Null without the API key: catalog prices then read as unavailable. */
export function cjClientFromEnv(env: Env): CjClient | null {
	const apiKey = env.CJDROPSHIPPING_API_KEY;
	if (!apiKey) return null;
	const session = new CjSession({ kv: env.VibecoderStore, apiKey, fetchToken: (key) => requestCjAccessToken(key), now: () => Date.now() });
	return createCjClient({ session });
}
