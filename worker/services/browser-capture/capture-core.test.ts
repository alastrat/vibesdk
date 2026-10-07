import { describe, expect, it } from 'vitest';
import { runScreenshot } from './capture-core';
import type { CapturePage, ScreenshotPayload } from './types';

interface FakePage {
	page: CapturePage;
	calls: string[];
	screenshotOptions: unknown[];
	gotoOptions: unknown[];
}

function fakePage(options: { gotoError?: Error; screenshot?: string } = {}): FakePage {
	const calls: string[] = [];
	const screenshotOptions: unknown[] = [];
	const gotoOptions: unknown[] = [];
	const page: CapturePage = {
		on: () => undefined,
		setViewport: async (v) => {
			calls.push(`viewport ${v.width}x${v.height}`);
		},
		goto: async (url, opts) => {
			calls.push(`goto ${url}`);
			gotoOptions.push(opts);
			if (options.gotoError) throw options.gotoError;
			return null;
		},
		evaluate: async () => undefined,
		screenshot: async (opts) => {
			calls.push('screenshot');
			screenshotOptions.push(opts);
			return options.screenshot ?? 'iVBORw0KGgo=';
		},
		close: async () => {
			calls.push('close');
		},
	};
	return { page, calls, screenshotOptions, gotoOptions };
}

const PAYLOAD: ScreenshotPayload = {
	url: 'https://preview.estori.app/app-1/',
	viewport: { width: 1280, height: 720 },
	timeoutMs: 15_000,
	settleMs: 0,
};

describe('runScreenshot', () => {
	it('loads the page at the viewport size and returns a base64 PNG of the viewport', async () => {
		const fake = fakePage({ screenshot: 'base64-png' });
		await expect(runScreenshot(fake.page, PAYLOAD)).resolves.toBe('base64-png');
		expect(fake.calls).toEqual(['viewport 1280x720', `goto ${PAYLOAD.url}`, 'screenshot', 'close']);
		expect(fake.gotoOptions).toEqual([{ waitUntil: 'networkidle2', timeout: 15_000 }]);
		expect(fake.screenshotOptions).toEqual([{ type: 'png', fullPage: false, encoding: 'base64' }]);
	});

	it('closes the page and rethrows when navigation fails', async () => {
		const fake = fakePage({ gotoError: new Error('Navigation timeout of 15000 ms exceeded') });
		await expect(runScreenshot(fake.page, PAYLOAD)).rejects.toThrow('Navigation timeout');
		expect(fake.calls).toEqual(['viewport 1280x720', `goto ${PAYLOAD.url}`, 'close']);
	});
});
