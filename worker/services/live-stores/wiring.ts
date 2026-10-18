/** Live stores' flows with their production dependencies, and their scheduled work. */

import { LiveStoreService } from '../../database/services/LiveStoreService';
import { createLogger } from '../../logger';
import { sellerNoticesFromEnv } from '../alerts/seller-notices';
import { CATALOG_SWEEP_CRON } from '../catalog/scheduler';
import { sweepStoreDomains, type DomainFlowDeps } from './domain-checks';
import { domainProviderFromEnv } from './domains';
import { storeHostConfig } from './hosts';

const logger = createLogger('LiveStoresWiring');

export function domainFlowDepsFromEnv(env: Env): DomainFlowDeps {
	const config = storeHostConfig(env);
	// In development `.localhost` names are where custom domains live, so localhost isn't one of Estori's own there.
	const estoriDomains = [...new Set([config.customDomain, config.previewDomain])].filter((domain) => domain && !(config.dev && domain === 'localhost'));
	const stores = new LiveStoreService(env);
	const notifySeller = sellerNoticesFromEnv(env);
	return {
		provider: domainProviderFromEnv(env),
		stores,
		own: { storesDomain: config.storesDomain, estoriDomains },
		now: () => new Date(),
		warnSeller: async (domain) => {
			const store = await stores.storeForHostname(domain.hostname);
			if (store) await notifySeller({ sellerUserId: store.sellerUserId, kind: 'domain-unreachable', hostname: domain.hostname });
		},
	};
}

/** Hourly: domains waiting for DNS connect without the seller pressing Check now, and connected ones are rechecked. */
export async function runLiveStoresSchedule(cron: string, env: Env): Promise<void> {
	if (cron !== CATALOG_SWEEP_CRON) return;
	try {
		const result = await sweepStoreDomains(domainFlowDepsFromEnv(env));
		if (result.checked > 0) logger.info('Checked store domains', result);
	} catch (error) {
		logger.error('Domain check sweep failed', { error });
	}
}
