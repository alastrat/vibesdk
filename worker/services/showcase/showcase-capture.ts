/** Wires showcase captures to the browser capture client, R2 and D1. */

import type { StructuredLogger } from '../../logger';
import { AppService } from '../../database/services/AppService';
import { ImageType, uploadImage } from '../../utils/images';
import { SHOWCASE_VIEWPORT } from '../browser-capture/capture-core';
import { getBrowserCaptureClient } from '../browser-capture/factory';
import { SHOWCASE_SCREENSHOT_FILENAME, type ShowcaseCaptureDeps } from './showcase-screenshot';

const SHOWCASE_TIMEOUT_MS = 15_000;
const SHOWCASE_SETTLE_MS = 2_000;

export function createShowcaseCaptureDeps(env: Env, logger: StructuredLogger): ShowcaseCaptureDeps {
	const client = getBrowserCaptureClient(env, logger);
	const apps = new AppService(env);
	return {
		capture: (url) =>
			client.captureScreenshot({
				url,
				viewport: SHOWCASE_VIEWPORT,
				timeoutMs: SHOWCASE_TIMEOUT_MS,
				settleMs: SHOWCASE_SETTLE_MS,
				format: 'jpeg',
			}),
		store: async (appId, base64Jpeg) =>
			(
				await uploadImage(
					env,
					{ id: appId, filename: SHOWCASE_SCREENSHOT_FILENAME, mimeType: 'image/jpeg', base64Data: base64Jpeg },
					ImageType.SCREENSHOTS,
				)
			).publicUrl,
		save: (appId, url) => apps.updateAppShowcaseScreenshot(appId, url),
		logger,
	};
}
