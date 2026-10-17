/** Admins pin a seller's level or set their own limits; stored in the seller's user_config KV entry. */

import { BaseController } from '../baseController';
import type { ApiResponse, ControllerResponse } from '../types';
import type { RouteContext } from '../../types/route-context';
import { SELLER_LEVELS, type SellerLevel } from '../../../../shared/types/seller-levels';
import { syncSellerLevelFromEnv } from '../../../services/payments/seller-level-sync';
import { UserService } from '../../../database';

export interface SellerLimitsOverride {
	pinnedLevel?: SellerLevel | null;
	largestOrderCents?: number | null;
	weeklySalesCents?: number | null;
	payoutDelayDays?: number | null;
}

const RANGES: Readonly<Record<'largestOrderCents' | 'weeklySalesCents' | 'payoutDelayDays', readonly [number, number]>> = {
	largestOrderCents: [100, 10_000_000],
	weeklySalesCents: [100, 10_000_000],
	payoutDelayDays: [2, 31],
};

export function parseSellerLimitsOverride(body: unknown): SellerLimitsOverride | null {
	if (typeof body !== 'object' || body === null) return null;
	const entries = Object.entries(body as Record<string, unknown>);
	if (entries.length === 0) return null;
	const override: SellerLimitsOverride = {};
	for (const [key, value] of entries) {
		if (key === 'pinnedLevel') {
			if (value !== null && !(SELLER_LEVELS as readonly unknown[]).includes(value)) return null;
			override.pinnedLevel = value as SellerLevel | null;
		} else if (Object.hasOwn(RANGES, key)) {
			const [min, max] = RANGES[key as keyof typeof RANGES];
			if (value !== null && (!Number.isInteger(value) || (value as number) < min || (value as number) > max)) return null;
			override[key as keyof typeof RANGES] = value as number | null;
		} else {
			return null;
		}
	}
	return override;
}

export function mergeSellerLimitsOverride(stored: string | null, override: SellerLimitsOverride): string {
	const config = stored ? (JSON.parse(stored) as Record<string, unknown>) : {};
	const current = (config.sellerLimits ?? {}) as { pinnedLevel?: SellerLevel | null; overrides?: Record<string, number | null> };
	const { pinnedLevel, ...numbers } = override;
	const next = {
		pinnedLevel: pinnedLevel !== undefined ? pinnedLevel : (current.pinnedLevel ?? null),
		overrides: { ...(current.overrides ?? {}), ...numbers },
	};
	return JSON.stringify({ ...config, sellerLimits: next });
}

export class SellerLimitsAdminController extends BaseController {
	static async setLimits(request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<{ saved: true }>>> {
		const userId = context.pathParams.userId;
		const body = await SellerLimitsAdminController.parseJsonBody<unknown>(request);
		const override = userId && body.success ? parseSellerLimitsOverride(body.data) : null;
		if (!userId || !override) return SellerLimitsAdminController.createErrorResponse('Send a level to pin (or null) and limits in range', 400);
		try {
			if (!(await new UserService(env).findUser({ id: userId }))) return SellerLimitsAdminController.createErrorResponse('No user has this id', 404);
			const key = `user_config:${userId}`;
			await env.VibecoderStore.put(key, mergeSellerLimitsOverride(await env.VibecoderStore.get(key), override));
			// A new pin or delay reaches Stripe now, not at the next sale.
			await syncSellerLevelFromEnv(env, userId);
			return SellerLimitsAdminController.createSuccessResponse({ saved: true });
		} catch (error) {
			return SellerLimitsAdminController.handleError(error, "save a seller's limits") as ControllerResponse<ApiResponse<{ saved: true }>>;
		}
	}
}
