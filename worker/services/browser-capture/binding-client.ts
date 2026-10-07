/**
 * Production capture client. Drives a remote Chromium via the
 * Cloudflare `BROWSER` binding using `@cloudflare/puppeteer`, then
 * delegates to the shared capture core.
 */

import puppeteer from '@cloudflare/puppeteer';
import type { StructuredLogger } from '../../logger';
import { runCapture, runScreenshot } from './capture-core';
import type {
	BrowserCaptureClient,
	BrowserConsoleCaptureResult,
	CapturePage,
	CapturePayload,
	ScreenshotPayload,
} from './types';

export class BindingCaptureClient implements BrowserCaptureClient {
	constructor(
		private readonly env: Env,
		private readonly logger: StructuredLogger,
	) {}

	async captureConsoleLogs(
		payload: CapturePayload,
	): Promise<BrowserConsoleCaptureResult> {
		return this.withPage(payload.url, (page) => runCapture(page, payload));
	}

	async captureScreenshot(payload: ScreenshotPayload): Promise<string> {
		return this.withPage(payload.url, (page) => runScreenshot(page, payload));
	}

	/** Opens one remote Browser Run session for `run` and always closes it. */
	private async withPage<T>(
		url: string,
		run: (page: CapturePage) => Promise<T>,
	): Promise<T> {
		this.logger.info('Launching Browser Run via BROWSER binding', { url });
		// @cloudflare/puppeteer's launch accepts the BrowserWorker fetcher.
		// Cast at the boundary; the API surface puppeteer exposes is identical.
		const browser = await puppeteer.launch(
			this.env.BROWSER as unknown as Parameters<typeof puppeteer.launch>[0],
		);
		try {
			const page = (await browser.newPage()) as unknown as CapturePage;
			return await run(page);
		} finally {
			try {
				await browser.close();
			} catch (e) {
				this.logger.warn('Failed to close remote Browser Run session', {
					error: e instanceof Error ? e.message : String(e),
				});
			}
		}
	}
}
