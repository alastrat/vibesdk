import { describe, expect, it } from 'vitest';
import type { ReferenceCaptureResult, ReferencePayload } from '../../services/browser-capture/types';
import { ReferenceCaptureError } from '../../services/browser-capture/capture-core';
import { captureReferences, referenceFailureReason, type ReferenceDeps } from './reference-service';

const RESULT: ReferenceCaptureResult = {
	finalUrl: 'https://stripe.com/',
	shots: [
		{ kind: 'desktop-top', jpegBase64: 'AAAA', width: 1280, height: 800 },
		{ kind: 'mobile-top', jpegBase64: 'BBBB', width: 390, height: 844 },
	],
	design: {
		title: 'Stripe',
		palette: [],
		fonts: { body: '', headings: '', buttons: '' },
		headings: [],
		button: null,
		nav: [],
		sections: [],
		copy: '',
		images: [],
	},
};

function deps(capture: (payload: ReferencePayload) => Promise<ReferenceCaptureResult>, putError?: Error) {
	const payloads: ReferencePayload[] = [];
	const puts: { key: string; contentType: string; bytes: number }[] = [];
	let ids = 0;
	const value: ReferenceDeps = {
		client: {
			captureReference: (payload) => {
				payloads.push(payload);
				return capture(payload);
			},
		},
		bucket: {
			put: async (key, bytes, options) => {
				if (putError) throw putError;
				puts.push({ key, contentType: options.httpMetadata.contentType, bytes: bytes.byteLength });
				return null;
			},
		},
		appId: 'app-1',
		newCaptureId: () => `c${++ids}`,
	};
	return { value, payloads, puts };
}

describe('captureReferences', () => {
	it('captures a page and stores its screenshots under the app', async () => {
		const d = deps(async () => RESULT);
		const outcomes = await captureReferences(['https://stripe.com'], d.value, () => undefined);
		expect(d.payloads).toEqual([{ url: 'https://stripe.com/', timeoutMs: 20_000, settleMs: 1_500 }]);
		expect(d.puts).toEqual([
			{ key: 'screenshots/app-1/ref-c1-desktop-top.jpg', contentType: 'image/jpeg', bytes: 3 },
			{ key: 'screenshots/app-1/ref-c1-mobile-top.jpg', contentType: 'image/jpeg', bytes: 3 },
		]);
		expect(outcomes).toEqual([
			{
				url: 'https://stripe.com',
				host: 'stripe.com',
				ok: true,
				captureId: 'c1',
				shots: [
					{ kind: 'desktop-top', r2Key: 'screenshots/app-1/ref-c1-desktop-top.jpg' },
					{ kind: 'mobile-top', r2Key: 'screenshots/app-1/ref-c1-mobile-top.jpg' },
				],
				design: RESULT.design,
			},
		]);
	});

	it('rejects unsafe URLs without opening them', async () => {
		const d = deps(async () => RESULT);
		const outcomes = await captureReferences(['http://localhost:3000'], d.value, () => undefined);
		expect(d.payloads).toEqual([]);
		expect(outcomes).toEqual([{ url: 'http://localhost:3000', host: 'localhost', ok: false, reason: 'not a public web page' }]);
	});

	it('captures several pages at the same time', async () => {
		const started: string[] = [];
		const releases: Array<() => void> = [];
		const d = deps(
			(payload) =>
				new Promise((resolve) => {
					started.push(payload.url);
					releases.push(() => resolve(RESULT));
				}),
		);
		const pending = captureReferences(['https://a.com', 'https://b.com'], d.value, () => undefined);
		await Promise.resolve();
		expect(started).toEqual(['https://a.com/', 'https://b.com/']);
		releases.forEach((release) => release());
		expect((await pending).every((o) => o.ok)).toBe(true);
	});

	it('reports progress as the first unfinished page, in order', async () => {
		const releases = new Map<string, () => void>();
		const d = deps(
			(payload) =>
				new Promise((resolve) => {
					releases.set(payload.url, () => resolve(RESULT));
				}),
		);
		const seen: string[] = [];
		const pending = captureReferences(['https://a.com', 'https://b.com'], d.value, (host, index, total) =>
			seen.push(`${host} ${index}/${total}`),
		);
		await Promise.resolve();
		releases.get('https://a.com/')?.();
		await new Promise((r) => setTimeout(r, 0));
		releases.get('https://b.com/')?.();
		await pending;
		expect(seen).toEqual(['a.com 1/2', 'b.com 2/2']);
	});

	it('keeps every outcome when the progress callback throws', async () => {
		const d = deps(async () => RESULT);
		const outcomes = await captureReferences(['https://a.com', 'https://localhost:3000'], d.value, () => {
			throw new Error('socket closed');
		});
		expect(outcomes.map((o) => [o.host, o.ok])).toEqual([
			['a.com', true],
			['localhost', false],
		]);
		expect(d.puts.map((p) => p.key)).toEqual([
			'screenshots/app-1/ref-c1-desktop-top.jpg',
			'screenshots/app-1/ref-c1-mobile-top.jpg',
		]);
	});

	it('fails a page whose screenshots cannot be stored', async () => {
		const d = deps(async () => RESULT, new Error('R2 unavailable'));
		const [outcome] = await captureReferences(['https://stripe.com'], d.value, () => undefined);
		expect(outcome).toEqual({ url: 'https://stripe.com', host: 'stripe.com', ok: false, reason: 'the screenshots could not be saved' });
	});

	it('fails a page that takes longer than its budget', async () => {
		const d = deps(() => new Promise(() => undefined));
		const [outcome] = await captureReferences(['https://slow.com'], { ...d.value, budgetMs: 10 }, () => undefined);
		expect(outcome).toEqual({ url: 'https://slow.com', host: 'slow.com', ok: false, reason: 'timed out' });
	});
});

describe('referenceFailureReason', () => {
	it.each([
		[new ReferenceCaptureError('HTTP 403'), 'HTTP 403'],
		[new ReferenceCaptureError('not an HTML page'), 'not an HTML page'],
		[new Error('Navigation timeout of 20000 ms exceeded'), 'timed out'],
		[new Error('429 Too Many Requests'), 'Browser capture busy, try again'],
		[new Error('Browser Rendering concurrency limit reached'), 'Browser capture busy, try again'],
		[new Error('net::ERR_NAME_NOT_RESOLVED at https://nope.example'), 'the page could not be reached'],
		[new Error('Dev browser sidecar reference capture returned 500: {"error":"HTTP 403"}'), 'HTTP 403'],
		[new Error('Dev browser sidecar reference capture returned 500: {"error":"not an HTML page"}'), 'not an HTML page'],
		[new Error('something else'), 'the page could not be loaded'],
	])('maps %s to %s', (error, reason) => {
		expect(referenceFailureReason(error)).toBe(reason);
	});
});
