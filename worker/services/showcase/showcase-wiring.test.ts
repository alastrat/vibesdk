import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	['/worker/api/controllers/publishing/controller.ts', '/worker/agents/core/behaviors/think.ts'],
	{ query: '?raw', import: 'default', eager: true },
);

const CONTROLLER = '/worker/api/controllers/publishing/controller.ts';
const THINK = '/worker/agents/core/behaviors/think.ts';

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

describe('showcase capture triggers', () => {
	it('captures in the background once a public publish has succeeded', () => {
		const handler = between(source(CONTROLLER), 'static async updateVisibility(', 'return PublishingController.createSuccessResponse<PublishSiteData>(');
		const afterSuccess = handler.slice(handler.indexOf('if (!outcome.ok)'));
		expect(afterSuccess).toContain("if (parsed.value.visibility === 'public') {");
		expect(afterSuccess).toContain('ctx.waitUntil(refreshShowcaseScreenshot(env, PublishingController.logger, context.pathParams.id));');
	});

	it("refreshes a public store's showcase image right after its thumbnail", () => {
		const think = source(THINK);
		const override = between(think, 'override async captureScreenshot(', 'private captureDeployedScreenshot(): void {');
		expect(override.indexOf('this.queueShowcaseCapture();')).toBeGreaterThan(override.indexOf('screenshotCommit: commit'));
		const queue = between(think, 'private queueShowcaseCapture(): void {', 'private pendingScreenshotCommit(): string | null {');
		expect(queue).toContain('getPublishingState(appId)');
		expect(queue).toContain('showcaseEligible(publishing)');
		expect(queue).toContain('captureShowcaseScreenshot(createShowcaseCaptureDeps(this.env, this.logger), appId, previewUrl)');
	});

	it('captures the showcase from the public preview, never the URL an editor sent', () => {
		const think = source(THINK);
		const override = between(think, 'override async captureScreenshot(', 'private captureDeployedScreenshot(): void {');
		expect(override).not.toContain('queueShowcaseCapture(url');
		const queue = between(think, 'private queueShowcaseCapture(): void {', 'private pendingScreenshotCommit(): string | null {');
		expect(queue).toContain('const previewUrl = await this.getPublicPreviewURL();');
		expect(queue).toContain('if (!previewUrl) return null;');
		expect(queue).not.toMatch(/\burl\b/);
	});
});
