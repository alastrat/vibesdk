import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	[
		'/worker/agents/core/behaviors/base.ts',
		'/worker/agents/core/behaviors/think.ts',
		'/worker/agents/core/websocket.ts',
		'/worker/services/browser-capture/binding-client.ts',
		'/worker/services/browser-capture/sidecar-client.ts',
		'/scripts/dev-browser-sidecar.ts',
	],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

function between(text: string, start: string, end: string): string {
	const from = text.indexOf(start);
	if (from === -1) throw new Error(`Marker not found: ${start}`);
	const to = text.indexOf(end, from + start.length);
	if (to === -1) throw new Error(`Marker not found: ${end}`);
	return text.slice(from, to);
}

describe('app screenshots', () => {
	it('captures through the browser capture client, not the token-based REST API', () => {
		const capture = between(
			source('/worker/agents/core/behaviors/base.ts'),
			'private async executeScreenshotCapture(',
			'private async processAndStoreScreenshot(',
		);
		expect(capture).toContain('getBrowserCaptureClient(this.env, this.logger)');
		expect(capture).toContain('.captureScreenshot(');
		expect(capture).not.toContain('CLOUDFLARE_API_TOKEN');
		expect(capture).not.toContain('browser-rendering');
	});

	it('takes production screenshots through the BROWSER binding', () => {
		const client = source('/worker/services/browser-capture/binding-client.ts');
		expect(client).toContain('async captureScreenshot(');
		expect(client).toContain('runScreenshot(page, payload)');
	});

	it('takes dev screenshots through the local sidecar', () => {
		expect(source('/worker/services/browser-capture/sidecar-client.ts')).toContain('/capture-screenshot');
		const sidecar = source('/scripts/dev-browser-sidecar.ts');
		expect(sidecar).toContain("req.url === '/capture-screenshot'");
		expect(sidecar).toContain('runScreenshot(');
	});
});

describe('server-side thumbnails for Think apps', () => {
	const THINK = '/worker/agents/core/behaviors/think.ts';

	it('captures the deployed preview when a build ends', () => {
		const build = between(source(THINK), 'async build(): Promise<void> {', 'private async runPrompt(');
		expect(build).toMatch(/finally \{[^}]*this\.captureDeployedScreenshot\(\);/);
	});

	it('captures the deployed preview after a rollback redeploys', () => {
		const rollback = between(source(THINK), 'async rollbackToCommit(', 'private async handleSetTitleOutput(');
		expect(rollback).toContain('this.captureDeployedScreenshot();');
	});

	it('captures once per deployed commit, whoever asks', () => {
		const capture = between(source(THINK), 'override async captureScreenshot(', 'private captureDeployedScreenshot(');
		expect(capture).toContain('this.pendingScreenshotCommit()');
		expect(capture).toContain('screenshotCommit: commit');
		expect(source(THINK)).toContain('screenshotTarget({');
	});

	it('treats a skipped capture as current, not as a failure', () => {
		const handler = between(
			source('/worker/agents/core/websocket.ts'),
			'case WebSocketMessageRequests.CAPTURE_SCREENSHOT:',
			'case WebSocketMessageRequests.STOP_GENERATION:',
		);
		expect(handler).toContain('screenshotResult === null');
		expect(handler).not.toContain("logger.error('Failed to capture screenshot')");
	});
});
