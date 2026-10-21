/** What the signed-in session carries for analytics: the client flags, and the analytics setting with GPC honored. */

import { clientFlagValues } from '../../../shared/types/feature-flags';
import type { SessionTelemetry } from '../../../shared/types/telemetry';
import { AnalyticsPersonService } from '../../database/services/AnalyticsPersonService';
import { createLogger } from '../../logger';
import { flagsFor } from './flags';

const logger = createLogger('SessionTelemetry');

/** The browser's Global Privacy Control signal. */
export function gpcSignal(request: Request): boolean {
	return request.headers.get('Sec-GPC') === '1';
}

/**
 * Whether analytics is off for this user. A GPC signal is stored as the account's opt-out first, and the write is
 * awaited, so a caller that captures after this resolves never sends a person event for this request. When the setting
 * can't be read it answers true: privacy wins.
 */
export async function honorAnalyticsChoice(env: Env, request: Request, userId: string): Promise<boolean> {
	try {
		const people = new AnalyticsPersonService(env);
		if ((await people.preference(userId)).optedOut) return true;
		if (!gpcSignal(request)) return false;
		await people.setPreference(userId, true, 'gpc', new Date());
		return true;
	} catch (error) {
		logger.warn('Could not read the analytics setting; treating analytics as off', { userId, error });
		return true;
	}
}

export async function sessionTelemetry(env: Env, request: Request, userId: string): Promise<SessionTelemetry> {
	const analyticsOptOut = await honorAnalyticsChoice(env, request, userId);
	const { values } = await flagsFor(env, userId);
	return { flags: clientFlagValues(values), analyticsOptOut };
}
