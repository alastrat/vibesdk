/** JPEG screenshots of a deployed preview for template submissions. */

import type { StructuredLogger } from '../../logger';
import { DESKTOP_VIEWPORT, PHONE_VIEWPORT } from '../browser-capture/capture-core';
import { getBrowserCaptureClient } from '../browser-capture/factory';
import { base64ToUint8Array } from '../../utils/encoding';
import type { ShotDevice } from './submit';

const TEMPLATE_SHOT_TIMEOUT_MS = 15_000;
const TEMPLATE_SHOT_SETTLE_MS = 2_000;

export function createTemplateShotCapturer(
	env: Env,
	logger: StructuredLogger,
): (url: string, device: ShotDevice) => Promise<Uint8Array> {
	const client = getBrowserCaptureClient(env, logger);
	return async (url, device) =>
		base64ToUint8Array(
			await client.captureScreenshot({
				url,
				viewport: device === 'phone' ? PHONE_VIEWPORT : DESKTOP_VIEWPORT,
				timeoutMs: TEMPLATE_SHOT_TIMEOUT_MS,
				settleMs: TEMPLATE_SHOT_SETTLE_MS,
				format: 'jpeg',
			}),
		);
}
