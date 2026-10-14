/**
 * The tall Discover showcase image of a public store: capture, check, store
 * and record. Dependencies are injected so the rules are tested without a
 * browser, R2 or D1.
 */

import type { StructuredLogger } from '../../logger';
import { detectBlankScreenshot } from '../../utils/images';

export const SHOWCASE_SCREENSHOT_FILENAME = 'showcase.jpg';
/** Stores per admin refresh, and captures running at once, so a batch fits in one request. */
export const SHOWCASE_REFRESH_BATCH = 10;
export const SHOWCASE_REFRESH_CONCURRENCY = 3;
/** A real 1280x1650 page compresses to far more than this; a blank one doesn't. */
const SHOWCASE_MIN_BYTES = 15_000;

export type ShowcaseCaptureResult = 'stored' | 'blank' | 'failed';

export interface ShowcaseCaptureDeps {
	/** Base64 JPEG of the page at the showcase viewport. */
	capture(url: string): Promise<string>;
	/** Store the JPEG and return its URL. */
	store(appId: string, base64Jpeg: string): Promise<string>;
	/** Record the URL on the app; false when the app is gone. */
	save(appId: string, url: string): Promise<boolean>;
	logger: Pick<StructuredLogger, 'info' | 'warn'>;
}

/** Captures and records one store's showcase image. Never throws; a blank or failed capture keeps the previous image. */
export async function captureShowcaseScreenshot(
	deps: ShowcaseCaptureDeps,
	appId: string,
	previewUrl: string,
): Promise<ShowcaseCaptureResult> {
	try {
		const base64 = await deps.capture(previewUrl);
		const blank = detectBlankScreenshot(base64, SHOWCASE_MIN_BYTES);
		if (blank.isBlank) {
			deps.logger.warn('Showcase screenshot looked blank; keeping the previous one', { appId, reason: blank.reason });
			return 'blank';
		}
		const url = await deps.store(appId, base64);
		if (!(await deps.save(appId, url))) return 'failed';
		deps.logger.info('Showcase screenshot stored', { appId });
		return 'stored';
	} catch (error) {
		deps.logger.warn('Showcase screenshot capture failed', {
			appId,
			error: error instanceof Error ? error.message : String(error),
		});
		return 'failed';
	}
}

/** Refreshes stores a few at a time and counts the outcomes; anything not stored counts as failed. */
export async function runShowcaseRefresh(
	appIds: readonly string[],
	refreshOne: (appId: string) => Promise<ShowcaseCaptureResult>,
	concurrency = SHOWCASE_REFRESH_CONCURRENCY,
): Promise<{ captured: number; failed: number }> {
	let captured = 0;
	let failed = 0;
	for (let start = 0; start < appIds.length; start += concurrency) {
		const results = await Promise.all(appIds.slice(start, start + concurrency).map(refreshOne));
		for (const result of results) {
			if (result === 'stored') captured += 1;
			else failed += 1;
		}
	}
	return { captured, failed };
}

/** Only stores shown in Discover get a showcase image: public, and not removed by an admin. */
export function showcaseEligible(
	publishing: { visibility: 'private' | 'public'; removedFromDiscoverAt: Date | null } | null,
): boolean {
	return publishing?.visibility === 'public' && publishing.removedFromDiscoverAt === null;
}
