/**
 * Each flag's rollout, from PostHog's management API, for the flags admin page. It needs the optional
 * POSTHOG_PERSONAL_API_KEY secret; without it, or when PostHog fails, the page shows values only. Never throws.
 */

import { isFlagKey, type FlagKey } from '../../../shared/types/feature-flags';
import { POSTHOG_UI_ORIGIN, posthogConfig } from './config';

export const ROLLOUT_TIMEOUT_MS = 3_000;

type Rollouts = Partial<Record<FlagKey, number>>;

/**
 * The largest share any of a flag's conditions rolls out to. A condition without a percentage reaches everyone it
 * matches; a disabled flag reaches no one.
 */
export function rolloutsFrom(body: unknown): Rollouts {
	const results = (body as { results?: unknown } | null)?.results;
	if (!Array.isArray(results)) return {};
	const rollouts: Rollouts = {};
	for (const flag of results as Array<{ key?: unknown; active?: unknown; filters?: { groups?: Array<{ rollout_percentage?: unknown }> } }>) {
		if (typeof flag.key !== 'string' || !isFlagKey(flag.key)) continue;
		const shares = (flag.filters?.groups ?? []).map((group) => (typeof group.rollout_percentage === 'number' ? group.rollout_percentage : 100));
		rollouts[flag.key] = flag.active === true ? Math.max(0, ...shares) : 0;
	}
	return rollouts;
}

export async function flagRollouts(env: Env, fetcher: typeof fetch): Promise<Rollouts | null> {
	const apiKey = env.POSTHOG_PERSONAL_API_KEY?.trim();
	const projectId = posthogConfig(env)?.projectId;
	if (!apiKey || !projectId) return null;
	try {
		const response = await fetcher(`${POSTHOG_UI_ORIGIN}/api/projects/${encodeURIComponent(projectId)}/feature_flags/?limit=200`, {
			headers: { Authorization: `Bearer ${apiKey}` },
			signal: AbortSignal.timeout(ROLLOUT_TIMEOUT_MS),
		});
		return response.ok ? rolloutsFrom(await response.json()) : null;
	} catch {
		return null;
	}
}
