/**
 * Dev capture client. Talks to a local Node sidecar (`npm run dev:browser`)
 * over HTTP. The sidecar drives Chromium locally with `puppeteer` and
 * shares the `runCapture` core with the prod path.
 *
 * Contract: this client NEVER throws. When the sidecar is unreachable
 * or misbehaves we log a warning and return an empty result with a
 * `warning` field so the tool surfaces the situation to the LLM
 * without an error that would trigger retries.
 */

import type { StructuredLogger } from '../../logger';
import type {
	BrowserCaptureClient,
	BrowserConsoleCaptureResult,
	CapturePayload,
	ReferenceCaptureResult,
	ReferencePayload,
	ScreenshotPayload,
} from './types';

const DEFAULT_SIDECAR_URL = 'http://127.0.0.1:9223';
const DEFAULT_DEV_PREVIEW_ORIGIN = 'http://localhost:5173';
const HEALTH_PROBE_TIMEOUT_MS = 500;
const CAPTURE_TIMEOUT_MS = 90_000;

/**
 * Rewrite the host portion of an incoming preview URL to point at the
 * actual reachable dev origin. The agent's `getBrowserPreviewURL` can
 * produce internal-only hosts (e.g. `space-internal` when the
 * agent state's `wsOrigin` is contaminated by an internal RPC URL),
 * which the local Chromium can't resolve. Since the sidecar only runs
 * in dev, we know the user's dev server is at localhost:5173 (or a
 * configured override).
 */
function rewriteToLocalHost(rawUrl: string, devOrigin: string): string {
	try {
		const incoming = new URL(rawUrl);
		const target = new URL(devOrigin);
		incoming.protocol = target.protocol;
		incoming.host = target.host;
		return incoming.toString();
	} catch {
		// If the input isn't a valid URL, append it as a path under the dev origin.
		return `${devOrigin.replace(/\/$/, '')}/${rawUrl.replace(/^\//, '')}`;
	}
}

export class SidecarCaptureClient implements BrowserCaptureClient {
	constructor(
		private readonly env: Env,
		private readonly logger: StructuredLogger,
	) {}

	/**
	 * Unlike console capture, screenshots throw on failure: the caller
	 * retries and reports the error to the chat.
	 */
	async captureScreenshot(payload: ScreenshotPayload): Promise<string> {
		const resp = await fetch(`${this.sidecarBase()}/capture-screenshot`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ ...payload, url: this.localUrl(payload.url) }),
			signal: AbortSignal.timeout(CAPTURE_TIMEOUT_MS),
		});
		if (!resp.ok) {
			const text = await resp.text().catch(() => '');
			throw new Error(
				`Dev browser sidecar screenshot returned ${resp.status}: ${text.slice(0, 200)}. Start it with 'npm run dev:browser'.`,
			);
		}
		const { screenshot } = (await resp.json()) as { screenshot?: string };
		if (!screenshot) {
			throw new Error('Dev browser sidecar returned no screenshot');
		}
		return screenshot;
	}

	/**
	 * Reference URLs are public sites, so unlike previews they are sent to the
	 * sidecar unchanged. Throws on failure, like screenshots.
	 */
	async captureReference(payload: ReferencePayload): Promise<ReferenceCaptureResult> {
		const resp = await fetch(`${this.sidecarBase()}/capture-reference`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(payload),
			signal: AbortSignal.timeout(CAPTURE_TIMEOUT_MS),
		});
		if (!resp.ok) {
			const text = await resp.text().catch(() => '');
			throw new Error(`Dev browser sidecar reference capture returned ${resp.status}: ${text.slice(0, 200)}`);
		}
		return (await resp.json()) as ReferenceCaptureResult;
	}

	async captureConsoleLogs(
		payload: CapturePayload,
	): Promise<BrowserConsoleCaptureResult> {
		const base = this.sidecarBase();
		const localPayload: CapturePayload = { ...payload, url: this.localUrl(payload.url) };

		// Phase 1 — health probe with tight timeout so unavailability fails fast.
		try {
			const probe = await fetch(`${base}/health`, {
				signal: AbortSignal.timeout(HEALTH_PROBE_TIMEOUT_MS),
			});
			if (!probe.ok) {
				this.logger.warn('Dev browser sidecar health check failed', {
					base,
					status: probe.status,
				});
				return this.unavailable(localPayload, `health returned ${probe.status}`);
			}
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			this.logger.warn('Dev browser sidecar not reachable', { base, error: msg });
			return this.unavailable(localPayload, msg);
		}

		// Phase 2 — actual capture.
		try {
			const resp = await fetch(`${base}/capture-console-logs`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(localPayload),
				signal: AbortSignal.timeout(CAPTURE_TIMEOUT_MS),
			});
			if (!resp.ok) {
				const text = await resp.text().catch(() => '');
				this.logger.warn('Dev browser sidecar capture failed', {
					base,
					status: resp.status,
					text: text.slice(0, 500),
				});
				return this.unavailable(
					localPayload,
					`capture returned ${resp.status}: ${text.slice(0, 200)}`,
				);
			}
			return (await resp.json()) as BrowserConsoleCaptureResult;
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			this.logger.warn('Dev browser sidecar capture errored', { base, error: msg });
			return this.unavailable(localPayload, msg);
		}
	}

	private sidecarBase(): string {
		return this.env.DEV_BROWSER_SIDECAR_URL || DEFAULT_SIDECAR_URL;
	}

	/**
	 * Points a preview URL at the dev origin the local Chromium can reach.
	 * The path is preserved; only the scheme and host are rewritten.
	 */
	private localUrl(url: string): string {
		const devOrigin =
			this.env.DEV_BROWSER_PREVIEW_ORIGIN || DEFAULT_DEV_PREVIEW_ORIGIN;
		const rewritten = rewriteToLocalHost(url, devOrigin);
		if (rewritten !== url) {
			this.logger.info('Rewriting preview URL host for local dev capture', {
				original: url,
				rewritten,
			});
		}
		return rewritten;
	}

	private unavailable(
		payload: CapturePayload,
		reason: string,
	): BrowserConsoleCaptureResult {
		return {
			url: payload.url,
			capturedAt: new Date().toISOString(),
			logs: [],
			pageErrors: [],
			requestFailures: [],
			warning: `Dev browser sidecar unavailable: ${reason}. Start it with 'npm run dev:browser'.`,
		};
	}
}
