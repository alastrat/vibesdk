import { describe, expect, it } from 'vitest';
import { REFERENCE_EXTRACT_SCRIPT } from './reference-extract';
import { ReferenceCaptureError, runReferenceCapture, runScreenshot } from './capture-core';
import type { CapturePage, ReferencePayload, ScreenshotPayload } from './types';

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
		reload: async () => null,
		url: () => 'https://preview.estori.app/app-1/',
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

interface ReferenceFake {
	page: CapturePage;
	calls: string[];
	shotOptions: unknown[];
}

function referencePage(options: { status?: number; contentType?: string } = {}): ReferenceFake {
	const calls: string[] = [];
	const shotOptions: unknown[] = [];
	let shot = 0;
	const page: CapturePage = {
		on: () => undefined,
		setViewport: async (v) => {
			calls.push(`viewport ${v.width}x${v.height}${v.isMobile ? ' mobile' : ''}`);
		},
		goto: async (url, opts) => {
			calls.push(`goto ${url} ${opts?.timeout}`);
			return {
				status: () => options.status ?? 200,
				headers: () => ({ 'content-type': options.contentType ?? 'text/html; charset=utf-8' }),
			};
		},
		reload: async (opts) => {
			calls.push(`reload ${opts?.timeout}`);
			return null;
		},
		url: () => 'https://stripe.com/',
		evaluate: async (script) => {
			if (script === REFERENCE_EXTRACT_SCRIPT) {
				calls.push('extract');
				return { title: 'Stripe', palette: ['#635bff'], fonts: { body: 'Sohne' }, sections: [{ heading: 'Hero', columns: 2 }] };
			}
			calls.push(`run ${script}`);
			return undefined;
		},
		screenshot: async (opts) => {
			shotOptions.push(opts);
			calls.push('screenshot');
			shot += 1;
			return `shot-${shot}`;
		},
		close: async () => {
			calls.push('close');
		},
	};
	return { page, calls, shotOptions };
}

const REFERENCE: ReferencePayload = { url: 'https://stripe.com', timeoutMs: 20_000, settleMs: 0 };

describe('runReferenceCapture', () => {
	it('takes three desktop shots, extracts the design, then a phone shot', async () => {
		const fake = referencePage();
		const result = await runReferenceCapture(fake.page, REFERENCE);
		expect(fake.calls).toEqual([
			'viewport 1280x800',
			'goto https://stripe.com 20000',
			'screenshot',
			'run window.scrollTo(0, Math.floor(document.documentElement.scrollHeight * 0.4))',
			'screenshot',
			'run window.scrollTo(0, Math.floor(document.documentElement.scrollHeight * 0.8))',
			'screenshot',
			'extract',
			'viewport 390x844 mobile',
			'reload 20000',
			'run window.scrollTo(0, 0)',
			'screenshot',
			'close',
		]);
		expect(result.finalUrl).toBe('https://stripe.com/');
		expect(result.shots.map((s) => [s.kind, s.jpegBase64, s.width, s.height])).toEqual([
			['desktop-top', 'shot-1', 1280, 800],
			['desktop-middle', 'shot-2', 1280, 800],
			['desktop-lower', 'shot-3', 1280, 800],
			['mobile-top', 'shot-4', 390, 844],
		]);
		expect(result.design.palette).toEqual(['#635bff']);
		expect(result.design.sections).toEqual([{ heading: 'Hero', columns: 2, hasImage: false }]);
	});

	it('takes viewport-only JPEGs at quality 70', async () => {
		const fake = referencePage();
		await runReferenceCapture(fake.page, REFERENCE);
		expect(fake.shotOptions).toHaveLength(4);
		for (const options of fake.shotOptions) {
			expect(options).toEqual({ type: 'jpeg', quality: 70, fullPage: false, encoding: 'base64' });
		}
	});

	it('fails on an HTTP error and still closes the page', async () => {
		const fake = referencePage({ status: 404 });
		await expect(runReferenceCapture(fake.page, REFERENCE)).rejects.toThrow(new ReferenceCaptureError('HTTP 404'));
		expect(fake.calls).toEqual(['viewport 1280x800', 'goto https://stripe.com 20000', 'close']);
	});

	it('fails on a page that is not HTML', async () => {
		const fake = referencePage({ contentType: 'application/pdf' });
		await expect(runReferenceCapture(fake.page, REFERENCE)).rejects.toThrow('not an HTML page');
		expect(fake.calls).toContain('close');
	});
});
