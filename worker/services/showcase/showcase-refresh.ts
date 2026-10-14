/** Recaptures a store's showcase image from its public preview, for publishing and the admin refresh. */

import type { StructuredLogger } from '../../logger';
import { getAgentStub } from '../../agents';
import { createShowcaseCaptureDeps } from './showcase-capture';
import { captureShowcaseScreenshot, type ShowcaseCaptureResult } from './showcase-screenshot';

export async function refreshShowcaseScreenshot(env: Env, logger: StructuredLogger, appId: string): Promise<ShowcaseCaptureResult> {
	try {
		const previewUrl = await (await getAgentStub(env, appId)).getPublicPreviewURL();
		if (!previewUrl) {
			logger.warn('Showcase screenshot skipped: the store has no deployed public preview', { appId });
			return 'failed';
		}
		return await captureShowcaseScreenshot(createShowcaseCaptureDeps(env, logger), appId, previewUrl);
	} catch (error) {
		logger.warn('Showcase screenshot refresh failed', {
			appId,
			error: error instanceof Error ? error.message : String(error),
		});
		return 'failed';
	}
}
