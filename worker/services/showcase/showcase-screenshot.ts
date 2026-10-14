/**
 * The tall Discover showcase image of a public store: capture, check, store
 * and record. Dependencies are injected so the rules are tested without a
 * browser, R2 or D1.
 */

import type { StructuredLogger } from '../../logger';
import { base64ToUint8Array } from '../../utils/encoding';

export const SHOWCASE_SCREENSHOT_FILENAME = 'showcase.jpg';
/** Stores per admin refresh, and captures running at once, so a batch fits in one request. */
export const SHOWCASE_REFRESH_BATCH = 10;
export const SHOWCASE_REFRESH_CONCURRENCY = 3;
/** A 1280x1650 JPEG under this size is a blank page: Chrome encodes a uniform one in about 13 KB, real stores take 60 KB and up. */
const SHOWCASE_MIN_BYTES = 15_000;
/** Bits per byte of a JPEG's compressed scan: blank and flat pages measure 0 to 0.7, a bare error page 3.4, real stores 7.5 to 7.9. */
const SHOWCASE_MIN_SCAN_ENTROPY = 5;

/** Bits per byte of a JPEG's entropy-coded scan (after the start-of-scan header); the whole input when there is no scan marker. */
export function jpegScanEntropy(bytes: Uint8Array): number {
	let scan = bytes;
	for (let i = 0; i + 3 < bytes.length; i += 1) {
		if (bytes[i] === 0xff && bytes[i + 1] === 0xda) {
			const headerLength = (bytes[i + 2] << 8) | bytes[i + 3];
			scan = bytes.subarray(i + 2 + headerLength, Math.max(i + 2 + headerLength, bytes.length - 2));
			break;
		}
	}
	if (scan.length === 0) return 0;
	const counts = new Array<number>(256).fill(0);
	for (const byte of scan) counts[byte] += 1;
	let entropy = 0;
	for (const count of counts) {
		if (count === 0) continue;
		const p = count / scan.length;
		entropy -= p * Math.log2(p);
	}
	return entropy;
}

/** A capture too small or too uniform to be a real page. */
export function looksBlank(base64Jpeg: string, minBytes = SHOWCASE_MIN_BYTES): { isBlank: boolean; reason: string } {
	const bytes = base64ToUint8Array(base64Jpeg);
	if (bytes.length < minBytes) return { isBlank: true, reason: `only ${bytes.length} bytes` };
	const entropy = jpegScanEntropy(bytes);
	if (entropy < SHOWCASE_MIN_SCAN_ENTROPY) return { isBlank: true, reason: `scan entropy ${entropy.toFixed(2)}` };
	return { isBlank: false, reason: '' };
}

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
		const blank = looksBlank(base64);
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
