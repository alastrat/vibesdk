/**
 * Captures the reference URLs of a turn in parallel and stores their
 * screenshots in R2, where the screenshot endpoint and the model transport
 * can read them. Never throws: every URL ends as a captured or failed outcome.
 */

import { ReferenceCaptureError } from '../../services/browser-capture/capture-core';
import type { BrowserCaptureClient } from '../../services/browser-capture/types';
import { referenceHost, validateReferenceUrl, type ReferenceOutcome } from './references';

export const REFERENCE_NAV_TIMEOUT_MS = 20_000;
export const REFERENCE_SETTLE_MS = 1_500;
export const REFERENCE_CAPTURE_BUDGET_MS = 45_000;

export interface ReferenceDeps {
	client: Pick<BrowserCaptureClient, 'captureReference'>;
	bucket: { put(key: string, value: Uint8Array, options: { httpMetadata: { contentType: string } }): Promise<unknown> };
	appId: string;
	newCaptureId: () => string;
	/** Overall time allowed per URL; defaults to REFERENCE_CAPTURE_BUDGET_MS. */
	budgetMs?: number;
}

class CaptureTimeout extends Error {}
class StorageFailure extends Error {}

function withBudget<T>(promise: Promise<T>, ms: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new CaptureTimeout('timed out')), ms);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error: unknown) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}

/** A short reason for the reference card and the model. */
export function referenceFailureReason(error: unknown): string {
	if (error instanceof CaptureTimeout) return 'timed out';
	if (error instanceof StorageFailure) return 'the screenshots could not be saved';
	if (error instanceof ReferenceCaptureError) return error.message;
	const message = error instanceof Error ? error.message : String(error);

	// Check for wrapped sidecar errors first, before other patterns
	const httpMatch = message.match(/\bHTTP \d{3}\b/);
	if (httpMatch) return httpMatch[0];
	if (message.includes('not an HTML page')) return 'not an HTML page';

	if (/\b429\b|too many|rate limit|concurrenc/i.test(message)) return 'Browser capture busy, try again';
	if (/timeout|timed out/i.test(message)) return 'timed out';
	if (/net::|ERR_/.test(message)) return 'the page could not be reached';
	return 'the page could not be loaded';
}

async function captureOne(url: string, deps: ReferenceDeps): Promise<ReferenceOutcome> {
	const host = referenceHost(url);
	const valid = validateReferenceUrl(url);
	if (!valid.ok) return { url, host, ok: false, reason: 'not a public web page' };
	try {
		const result = await withBudget(
			deps.client.captureReference({
				url: valid.url.toString(),
				timeoutMs: REFERENCE_NAV_TIMEOUT_MS,
				settleMs: REFERENCE_SETTLE_MS,
			}),
			deps.budgetMs ?? REFERENCE_CAPTURE_BUDGET_MS,
		);
		const captureId = deps.newCaptureId();
		const shots = await Promise.all(
			result.shots.map(async (shot) => {
				const r2Key = `screenshots/${deps.appId}/ref-${captureId}-${shot.kind}.jpg`;
				try {
					await deps.bucket.put(r2Key, Buffer.from(shot.jpegBase64, 'base64'), {
						httpMetadata: { contentType: 'image/jpeg' },
					});
				} catch (error) {
					throw new StorageFailure(error instanceof Error ? error.message : String(error));
				}
				return { kind: shot.kind, r2Key };
			}),
		);
		return { url, host, ok: true, captureId, shots, design: result.design };
	} catch (error) {
		return { url, host, ok: false, reason: referenceFailureReason(error) };
	}
}

/**
 * Captures every URL at once. `onStart` names the first URL still being
 * captured, in order, and is called again whenever that changes.
 */
export async function captureReferences(
	urls: string[],
	deps: ReferenceDeps,
	onStart: (host: string, index: number, total: number) => void,
): Promise<ReferenceOutcome[]> {
	const finished = new Set<number>();
	let announced = -1;
	const announceNext = () => {
		const next = urls.findIndex((_, i) => !finished.has(i));
		if (next === -1 || next === announced) return;
		announced = next;
		onStart(referenceHost(urls[next]), next + 1, urls.length);
	};
	announceNext();
	return Promise.all(
		urls.map(async (url, i) => {
			try {
				return await captureOne(url, deps);
			} finally {
				finished.add(i);
				announceNext();
			}
		}),
	);
}
