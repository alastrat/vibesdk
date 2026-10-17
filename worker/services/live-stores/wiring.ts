/** Live stores' flows with their production dependencies, and their scheduled work. */

import { LiveStoreService } from '../../database/services/LiveStoreService';
import { createLogger } from '../../logger';
import { CATALOG_SWEEP_CRON } from '../catalog/scheduler';
import { sweepPendingDomains, type DomainFlowDeps } from './domain-checks';
import { domainProviderFromEnv } from './domains';
import { storeHostConfig } from './hosts';

const logger = createLogger('LiveStoresWiring');

export function domainFlowDepsFromEnv(env: Env): DomainFlowDeps {
	const config = storeHostConfig(env);
	// In development `.localhost` names are where custom domains live, so localhost isn't one of Estori's own there.
	const estoriDomains = [...new Set([config.customDomain, config.previewDomain])].filter((domain) => domain && !(config.dev && domain === 'localhost'));
	return { provider: domainProviderFromEnv(env), stores: new LiveStoreService(env), own: { storesDomain: config.storesDomain, estoriDomains }, now: () => new Date() };
}

/** Hourly: domains still waiting for DNS are checked, so they connect without the seller pressing Check now. */
export async function runLiveStoresSchedule(cron: string, env: Env): Promise<void> {
	if (cron !== CATALOG_SWEEP_CRON) return;
	try {
		const result = await sweepPendingDomains(domainFlowDepsFromEnv(env));
		if (result.checked > 0) logger.info('Checked domains waiting for DNS', result);
	} catch (error) {
		logger.error('Domain check sweep failed', { error });
	}
}
