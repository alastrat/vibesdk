/** The D1, agent, workspace and R2 reads behind resolveReuseStart. */

import { AppService, TemplateService } from '../../database';
import { getAgentStubLightweight, getSpaceTemplateStub } from '../../agents';
import { createLogger } from '../../logger';
import { readTemplateSnapshot } from './store';
import type { ReuseLookup } from './start';

const logger = createLogger('ReuseLookup');

export function createReuseLookup(env: Env): ReuseLookup {
	const apps = new AppService(env);
	const listings = new TemplateService(env);
	return {
		getSourceApp: (appId) => apps.getReuseSource(appId),
		getListingByApp: (appId) => listings.getListingByApp(appId),
		getVersion: (versionId) => listings.getVersion(versionId),
		hasPurchase: (listingId, userId) => listings.hasPurchase(listingId, userId),
		async getAgentFacts(appId) {
			try {
				const agent = await getAgentStubLightweight(env, appId);
				const [behaviorType, deployedCommit] = await Promise.all([agent.getBehaviorType(), agent.getDeployedCommit()]);
				return { behaviorType, deployedCommit };
			} catch (error) {
				logger.warn('Could not reach the source site agent', { appId, error });
				return { behaviorType: 'unknown', deployedCommit: null };
			}
		},
		async readLiveTree(appId, commit) {
			try {
				const space = getSpaceTemplateStub(env, appId);
				if (!space) throw new Error('The site workspace is unavailable');
				return await space.readTreeAtCommit(commit);
			} catch (error) {
				logger.warn('Could not read the source site files', { appId, error });
				throw error;
			}
		},
		async readSnapshot(snapshotKey) {
			try {
				return await readTemplateSnapshot(env.TEMPLATES_BUCKET, snapshotKey);
			} catch (error) {
				logger.warn('Could not read the source site snapshot', { snapshotKey, error });
				throw error;
			}
		},
	};
}
