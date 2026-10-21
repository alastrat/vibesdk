/** A week's notice before plan limits apply: one email to every account, with a line for those already over Basic's limits. */

import { catalogVariantIdsOf } from '@space-do/space';
import { BillingService } from '../../database/services/BillingService';
import { LiveStoreService } from '../../database/services/LiveStoreService';
import { createLogger } from '../../logger';
import { PLAN_LIMITS } from '../../../shared/types/plans';
import { claimAndSendNotice, claimingMailFromEnv, type ClaimingMailDeps } from './notices';

const logger = createLogger('EnforcementNotice');

const NOTICES_PER_RUN = 100;
const START_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface EnforcementDeps {
	/** Accounts not yet told under `key`, up to `limit`. */
	accounts(key: string, limit: number): Promise<string[]>;
	/** The ids of the account's apps whose stores are live. */
	liveStores(userId: string): Promise<string[]>;
	/** How many stores the account has started in its lifetime. */
	storesStarted(userId: string): Promise<number>;
	/** The price list of the app's live version; null when it has none. */
	liveManifest(appId: string): Promise<string | null>;
	mail: ClaimingMailDeps;
}

interface StoreManifestStub {
	getStoreManifest(branch: string): Promise<{ commitHash: string; manifest: string | null } | null>;
}

/** UTC midnight of a `YYYY-MM-DD` date; null for anything else, including a day the calendar doesn't have. */
export function enforcementStartsOn(value: string | undefined): number | null {
	const date = value?.trim();
	if (!date || !START_DATE.test(date)) return null;
	const [year, month, day] = date.split('-').map(Number);
	const startsOn = Date.UTC(year, month - 1, day);
	return new Date(startsOn).toISOString().slice(0, 10) === date ? startsOn : null;
}

/** True when the version sells at least one supplier catalog product; a manifest that doesn't parse sells none. */
export function sellsCatalogProducts(manifest: string | null): boolean {
	return catalogVariantIdsOf(manifest).size > 0;
}

/** Whether the account has more than Basic includes: live stores, stores started, or catalog products in a live store. */
async function overBasic(deps: EnforcementDeps, userId: string): Promise<boolean> {
	const { liveStores, storesLifetime } = PLAN_LIMITS.basic;
	const live = await deps.liveStores(userId);
	if (liveStores !== null && live.length > liveStores) return true;
	if (storesLifetime !== null && (await deps.storesStarted(userId)) > storesLifetime) return true;
	for (const appId of live) {
		if (sellsCatalogProducts(await deps.liveManifest(appId))) return true;
	}
	return false;
}

/**
 * Emails up to 100 accounts not yet told about the plans that start on `startsOnMs`, and answers how many went out. An
 * account whose lookups fail is logged and left for the next run. Once the date has come nothing is sent.
 */
export async function sendEnforcementNotices(deps: EnforcementDeps, startsOnMs: number, nowMs: number): Promise<number> {
	// Without a sender nothing is claimed, so every account is still told when one is set up.
	if (nowMs >= startsOnMs || !deps.mail.sender) return 0;
	const key = `enforcement_notice:${new Date(startsOnMs).toISOString().slice(0, 10)}`;
	let sent = 0;
	for (const userId of await deps.accounts(key, NOTICES_PER_RUN)) {
		try {
			const overLimits = await overBasic(deps, userId);
			const result = await claimAndSendNotice(deps.mail, userId, { key, email: { kind: 'enforcement_notice', startsOn: startsOnMs, overLimits } });
			if (result === 'sent') sent += 1;
		} catch (error) {
			logger.error('Could not send the enforcement notice', { userId, error });
		}
	}
	return sent;
}

function storeManifestStub(env: Env, appId: string): StoreManifestStub | null {
	const namespace = (env as unknown as { SPACE_DO?: DurableObjectNamespace }).SPACE_DO;
	return namespace ? (namespace.get(namespace.idFromName(appId)) as unknown as StoreManifestStub) : null;
}

export function enforcementDepsFromEnv(env: Env): EnforcementDeps {
	const billing = new BillingService(env);
	const stores = new LiveStoreService(env);
	return {
		accounts: (key, limit) => billing.accountsWithoutNotice(key, limit),
		liveStores: (userId) => stores.liveAppsOf(userId),
		storesStarted: (userId) => billing.storesStartedOf(userId),
		liveManifest: async (appId) => (await storeManifestStub(env, appId)?.getStoreManifest('live'))?.manifest ?? null,
		mail: claimingMailFromEnv(env),
	};
}
