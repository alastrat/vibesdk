/**
 * Puppeteer-agnostic console-log capture core.
 *
 * Both the in-worker `BindingCaptureClient` (which uses
 * `@cloudflare/puppeteer` against the `BROWSER` binding) and the
 * out-of-worker dev sidecar (which uses regular `puppeteer`) feed a
 * `Page` here so navigation + listener wiring lives in exactly one
 * place.
 */

import type {
	CaptureNavigationResponse,
	CapturePage,
	CapturePayload,
	BrowserConsoleCaptureResult,
	BrowserConsoleEntry,
	BrowserConsolePageError,
	BrowserConsoleRequestFailure,
	ReferenceCaptureResult,
	ReferencePayload,
	ReferenceShot,
	ReferenceShotKind,
	ScreenshotPayload,
} from './types';
import { REFERENCE_EXTRACT_SCRIPT, normalizeReferenceDesign } from './reference-extract';

const PAGE_LOAD_TIMEOUT_MS = 30_000;

export async function runCapture(
	page: CapturePage,
	payload: CapturePayload,
): Promise<BrowserConsoleCaptureResult> {
	const logs: BrowserConsoleEntry[] = [];
	const pageErrors: BrowserConsolePageError[] = [];
	const requestFailures: BrowserConsoleRequestFailure[] = [];

	page.on('console', (msg) => {
		try {
			logs.push({
				level: msg.type(),
				text: msg.text(),
				location: msg.location(),
			});
		} catch {
			// best-effort capture; never let a listener crash the page
		}
	});
	page.on('pageerror', (err) => {
		pageErrors.push({ message: err.message, stack: err.stack });
	});
	page.on('requestfailed', (req) => {
		try {
			requestFailures.push({
				url: req.url(),
				method: req.method(),
				failure: req.failure()?.errorText ?? 'unknown',
			});
		} catch {
			// ignore listener errors
		}
	});
	page.on('response', (res) => {
		try {
			const status = res.status();
			if (status >= 400) {
				requestFailures.push({
					url: res.url(),
					method: res.request().method(),
					failure: `HTTP ${status}`,
					status,
				});
			}
		} catch {
			// ignore listener errors
		}
	});

	try {
		await page.setViewport(payload.viewport);
		await page.goto(payload.url, {
			waitUntil: 'networkidle2',
			timeout: PAGE_LOAD_TIMEOUT_MS,
		});
		if (payload.interactScript) {
			await page.evaluate(payload.interactScript);
		}
		const waitMs = Math.max(0, payload.waitSeconds) * 1000;
		if (waitMs > 0) {
			await new Promise((r) => setTimeout(r, waitMs));
		}
	} finally {
		try {
			await page.close();
		} catch {
			// ignore close failures
		}
	}

	return {
		url: payload.url,
		capturedAt: new Date().toISOString(),
		logs,
		pageErrors,
		requestFailures,
	};
}

/** Loads the page at the payload's viewport and returns a base64 PNG of that viewport. */
export async function runScreenshot(
	page: CapturePage,
	payload: ScreenshotPayload,
): Promise<string> {
	try {
		await page.setViewport(payload.viewport);
		await page.goto(payload.url, {
			waitUntil: 'networkidle2',
			timeout: payload.timeoutMs,
		});
		if (payload.settleMs > 0) {
			await new Promise((r) => setTimeout(r, payload.settleMs));
		}
		return await page.screenshot({ type: 'png', fullPage: false, encoding: 'base64' });
	} finally {
		try {
			await page.close();
		} catch {
			// ignore close failures
		}
	}
}

/** A reference page that loaded but cannot be used, with the reason as its message. */
export class ReferenceCaptureError extends Error {}

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844, isMobile: true, hasTouch: true };
const REFERENCE_JPEG = { type: 'jpeg', quality: 70, fullPage: false, encoding: 'base64' } as const;
const SCROLL_STOPS: Array<[ReferenceShotKind, number]> = [
	['desktop-middle', 0.4],
	['desktop-lower', 0.8],
];

function assertHtmlPage(response: CaptureNavigationResponse | null): void {
	if (!response) return;
	const status = response.status();
	if (status >= 400) throw new ReferenceCaptureError(`HTTP ${status}`);
	const type = response.headers()['content-type'] ?? '';
	if (type && !type.includes('text/html') && !type.includes('application/xhtml')) {
		throw new ReferenceCaptureError('not an HTML page');
	}
}

/**
 * Captures a reference page: three desktop screenshots down the page, the
 * design data from its rendered styles, and a phone screenshot of the top.
 */
export async function runReferenceCapture(
	page: CapturePage,
	payload: ReferencePayload,
): Promise<ReferenceCaptureResult> {
	const settle = () =>
		payload.settleMs > 0 ? new Promise<void>((r) => setTimeout(r, payload.settleMs)) : Promise.resolve();
	try {
		await page.setViewport(DESKTOP);
		assertHtmlPage(await page.goto(payload.url, { waitUntil: 'networkidle2', timeout: payload.timeoutMs }));
		await settle();
		const shots: ReferenceShot[] = [
			{ kind: 'desktop-top', jpegBase64: await page.screenshot(REFERENCE_JPEG), ...DESKTOP },
		];
		for (const [kind, fraction] of SCROLL_STOPS) {
			await page.evaluate(`window.scrollTo(0, Math.floor(document.documentElement.scrollHeight * ${fraction}))`);
			await settle();
			shots.push({ kind, jpegBase64: await page.screenshot(REFERENCE_JPEG), ...DESKTOP });
		}
		const design = normalizeReferenceDesign(await page.evaluate(REFERENCE_EXTRACT_SCRIPT));
		const finalUrl = page.url();

		await page.setViewport(PHONE);
		await page.reload({ waitUntil: 'networkidle2', timeout: payload.timeoutMs });
		await settle();
		await page.evaluate('window.scrollTo(0, 0)');
		shots.push({
			kind: 'mobile-top',
			jpegBase64: await page.screenshot(REFERENCE_JPEG),
			width: PHONE.width,
			height: PHONE.height,
		});
		return { finalUrl, shots, design };
	} finally {
		try {
			await page.close();
		} catch {
			// ignore close failures
		}
	}
}
