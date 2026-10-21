/**
 * Refreshes the texts a store shows shoppers from its deployments: the live store when it is open, and the draft the
 * preview serves, so text about to be published is translated too. A SpaceDO that can't answer is reported in the
 * result, not thrown.
 */

import type { DeploymentTexts } from '@space-do/space';
import { createLogger } from '../../logger';
import { withDurableObjectResetRetry } from '../../agents/think/space-workspace-ops';
import { LiveStoreService } from '../../database/services/LiveStoreService';
import { StoreTranslationService } from '../../database/services/StoreTranslationService';
import { extractStoreTexts } from './extract';
import { hasSpaceBinding, spaceStubOf } from './space';

const logger = createLogger('StoreTexts');

/** The deployment reads of SpaceDO that extraction needs. */
interface TextsSpaceStub {
	getActiveDraft(): Promise<{ branch: string }>;
	getDeploymentTexts(branch: string): Promise<DeploymentTexts | null>;
}

export interface RefreshedStoreTexts {
	/** Texts now stored for the store. */
	count: number;
	/** The store has more texts than the limit, so the extraction stopped at it. */
	truncated: boolean;
	/** The store's product file couldn't be understood, so its products weren't read. */
	manifestInvalid: boolean;
	/** False when the store was never deployed, or when its deployments couldn't be read; `error` says which. */
	deployed: boolean;
	/** SpaceDO couldn't answer, so the stored texts are as they were. */
	error?: 'unavailable';
}

const UNAVAILABLE: RefreshedStoreTexts = { count: 0, truncated: false, manifestInvalid: false, deployed: false, error: 'unavailable' };

/** The deployments to read, live first so its text is translated before the draft's. */
async function readDeployments(space: TextsSpaceStub, includeLive: boolean): Promise<DeploymentTexts[]> {
	const deployments: DeploymentTexts[] = [];
	if (includeLive) {
		const live = await space.getDeploymentTexts('live');
		if (live) deployments.push(live);
	}
	const draft = await space.getDeploymentTexts((await space.getActiveDraft()).branch);
	// A draft that is the published version has the same text.
	if (draft && !deployments.some((deployment) => deployment.commitHash === draft.commitHash)) deployments.push(draft);
	return deployments;
}

/**
 * Reads the live deployment (only while the store is live), then the active draft's, and stores the union of their
 * texts in place of the last extraction. A store never deployed gives `deployed: false` and changes nothing; a SpaceDO
 * that fails after one retry gives `error: 'unavailable'`, also changing nothing.
 */
export async function refreshStoreTexts(env: Env, appId: string, now: number = Date.now()): Promise<RefreshedStoreTexts> {
	const live = await new LiveStoreService(env).getByApp(appId);
	if (!hasSpaceBinding(env)) {
		logger.warn('SPACE_DO binding is not configured', { appId });
		return UNAVAILABLE;
	}

	let deployments: DeploymentTexts[];
	try {
		deployments = await withDurableObjectResetRetry(
			() => spaceStubOf<TextsSpaceStub>(env, appId),
			(space) => readDeployments(space, live?.status === 'live'),
		);
	} catch (error) {
		logger.warn('Could not read the store deployments', { appId, error });
		return UNAVAILABLE;
	}
	if (deployments.length === 0) return { count: 0, truncated: false, manifestInvalid: false, deployed: false };

	const { texts, truncated, manifestInvalid } = await extractStoreTexts(deployments);
	await new StoreTranslationService(env).replaceTexts(appId, texts, now, { truncated, manifestInvalid });
	return { count: texts.length, truncated, manifestInvalid, deployed: true };
}
