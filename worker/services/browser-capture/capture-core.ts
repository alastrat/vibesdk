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
	CapturePage,
	CapturePayload,
	BrowserConsoleCaptureResult,
	BrowserConsoleEntry,
	BrowserConsolePageError,
	BrowserConsoleRequestFailure,
} from './types';

const PAGE_LOAD_TIMEOUT_MS = 30_000;

/** Waits `ms`, or rejects with the abort reason as soon as `signal` aborts. */
function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const onAbort = () => {
			clearTimeout(timer);
			reject(signal?.reason);
		};
		const timer = setTimeout(() => {
			signal?.removeEventListener('abort', onAbort);
			resolve();
		}, ms);
		if (signal?.aborted) onAbort();
		signal?.addEventListener('abort', onAbort, { once: true });
	});
}

/**
 * Loads the page and collects its output. Once `signal` aborts, it closes the
 * page, which fails a navigation or script still in flight, and rejects with
 * the abort reason.
 */
export async function runCapture(
	page: CapturePage,
	payload: CapturePayload,
	signal?: AbortSignal,
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

	const closeOnAbort = () => {
		page.close().catch(() => {
			// ignore close failures
		});
	};
	signal?.addEventListener('abort', closeOnAbort, { once: true });
	try {
		signal?.throwIfAborted();
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
			await delay(waitMs, signal);
		}
	} catch (error) {
		// After an abort, the page errors from closing it mean the capture was stopped.
		signal?.throwIfAborted();
		throw error;
	} finally {
		signal?.removeEventListener('abort', closeOnAbort);
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
