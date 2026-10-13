import { describe, expect, it } from 'vitest';
import {
	EMPTY_TEMPLATE_ERROR,
	MAX_TEMPLATE_BYTES,
	MAX_TEMPLATE_FILES,
	TEMPLATE_LIMIT_ERROR,
	buildSnapshot,
	bundleToFiles,
	isExcludedFromSnapshot,
	isSafeSeedPath,
	parseBundle,
	type TreeFile,
} from './snapshot';

const encoder = new TextEncoder();

function text(path: string, content: string): TreeFile {
	return { path, bytes: encoder.encode(content) };
}

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe]);

describe('isExcludedFromSnapshot', () => {
	it.each([
		'/.git/HEAD',
		'/.think/space.json',
		'/.afs/state.json',
		'/.env',
		'/.env.local',
		'/worker/.dev.vars',
		'/nested/.git/config',
		'/.dev.vars.production',
		'/.env/secrets.txt',
	])(
		'drops %s',
		(path) => {
			expect(isExcludedFromSnapshot(path)).toBe(true);
		},
	);

	it.each(['/index.html', '/src/env.ts', '/src/config/environment.ts', '/public/.well-known/security.txt'])(
		'keeps %s',
		(path) => {
			expect(isExcludedFromSnapshot(path)).toBe(false);
		},
	);
});

describe('buildSnapshot', () => {
	it('stores text as utf8 and binary as base64, with paths relative to the root', () => {
		const html = '<h1>Café</h1>';
		const result = buildSnapshot([
			text('/index.html', html),
			{ path: '/logo.png', bytes: PNG_BYTES },
			text('/.think/space.json', '{}'),
		]);
		expect(result).toEqual({
			ok: true,
			fileCount: 2,
			totalBytes: encoder.encode(html).byteLength + PNG_BYTES.byteLength,
			bundle: {
				files: [
					{ path: 'index.html', encoding: 'utf8', content: html },
					{ path: 'logo.png', encoding: 'base64', content: 'iVBORw0KGgoA//4=' },
				],
			},
		});
	});

	it('keeps exact bytes through a bundle round trip, including non-UTF-8 text and large binaries', () => {
		const latin1 = new Uint8Array([0x63, 0x61, 0x66, 0xe9]);
		const large = new Uint8Array(300_000).map((_, i) => (i * 7 + 3) % 256);
		const result = buildSnapshot([
			text('/src/app.ts', 'export const x = 1;\n'),
			{ path: '/fonts/a.woff2', bytes: large },
			{ path: '/legacy.txt', bytes: latin1 },
		]);
		if (!result.ok) throw new Error(result.error);

		const restored = parseBundle(JSON.stringify(result.bundle));

		expect(restored.map((file) => file.path)).toEqual(['fonts/a.woff2', 'legacy.txt', 'src/app.ts']);
		expect(restored[0].bytes).toEqual(large);
		expect(restored[1].bytes).toEqual(latin1);
		expect(new TextDecoder().decode(restored[2].bytes)).toBe('export const x = 1;\n');
	});

	it('keeps a UTF-8 byte order mark through a round trip', () => {
		const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...encoder.encode('hello')]);
		const result = buildSnapshot([{ path: '/bom.txt', bytes: withBom }]);
		if (!result.ok) throw new Error(result.error);
		expect(result.bundle.files[0].encoding).toBe('utf8');
		expect(parseBundle(JSON.stringify(result.bundle))[0].bytes).toEqual(withBom);
	});

	it('accepts exactly 500 files', () => {
		const files = Array.from({ length: MAX_TEMPLATE_FILES }, (_, i) => text(`/f${i}.txt`, 'x'));
		expect(buildSnapshot(files)).toMatchObject({ ok: true, fileCount: MAX_TEMPLATE_FILES });
	});

	it('rejects more than 500 files', () => {
		const files = Array.from({ length: MAX_TEMPLATE_FILES + 1 }, (_, i) => text(`/f${i}.txt`, 'x'));
		expect(buildSnapshot(files)).toEqual({ ok: false, error: TEMPLATE_LIMIT_ERROR });
	});

	it('rejects more than 10 MB in total', () => {
		expect(buildSnapshot([{ path: '/big.bin', bytes: new Uint8Array(MAX_TEMPLATE_BYTES + 1) }])).toEqual({
			ok: false,
			error: TEMPLATE_LIMIT_ERROR,
		});
	});

	it('does not count excluded files toward the limits', () => {
		const files = [
			text('/index.html', 'hi'),
			...Array.from({ length: 600 }, (_, i) => text(`/.git/objects/${i}`, 'x')),
		];
		expect(buildSnapshot(files)).toMatchObject({ ok: true, fileCount: 1 });
	});

	it('rejects an app with nothing left to publish', () => {
		expect(buildSnapshot([text('/.think/space.json', '{}')])).toEqual({ ok: false, error: EMPTY_TEMPLATE_ERROR });
	});

	const SECRET_SAMPLES: Array<[string, string]> = [
		['a private key block', '-----BEGIN RSA ' + 'PRIVATE KEY-----\nMIIB'],
		['an AWS access key', 'const id = "AKIA' + 'ABCDEFGHIJKLMNOP";'],
		['a GitHub token', 'token: ghp_' + 'a'.repeat(36)],
		['a GitHub fine-grained token', 'github_pat_' + 'A'.repeat(30)],
		['a Slack token', 'xoxb-' + '1234567890-abc'],
		['a Stripe live key', "stripe('sk_" + 'live_' + '0'.repeat(24) + "')"],
		['an Anthropic key', 'sk-ant-' + 'x'.repeat(40)],
		['an OpenAI key', 'sk-proj-' + 'y'.repeat(40)],
		['an api_key assignment', 'api_key = "' + 'z'.repeat(24) + '"'],
		['a secret assignment', "secret: '" + 'q'.repeat(24) + "'"],
	];

	it.each(SECRET_SAMPLES)('names the file holding %s', (_label, content) => {
		const result = buildSnapshot([text('/index.html', 'ok'), text('/src/config.ts', content)]);
		expect(result).toEqual({
			ok: false,
			error: 'src/config.ts looks like it contains a secret key; remove it and redeploy',
		});
	});

	it('scans pathological inputs in linear time', () => {
		const longLetterRun = performance.now();
		expect(buildSnapshot([text('/letters.txt', 'a'.repeat(200_000))])).toMatchObject({ ok: true });
		const letterRunMs = performance.now() - longLetterRun;
		expect(letterRunMs).toBeLessThan(1000);

		const repeatedKeyword = performance.now();
		expect(buildSnapshot([text('/keyword.txt', 'secret'.repeat(100_000))])).toMatchObject({ ok: true });
		const keywordMs = performance.now() - repeatedKeyword;
		expect(keywordMs).toBeLessThan(1000);
	});

	it.each([
		'const apiKey = import.meta.env.VITE_MAPS_KEY;',
		'secret: process.env.SESSION_SECRET,',
		'const secretMessage = "hi";',
		'<input name="api_key" placeholder="Paste your key">',
	])('does not flag %s', (content) => {
		expect(buildSnapshot([text('/src/config.ts', content)])).toMatchObject({ ok: true });
	});
});

describe('isSafeSeedPath', () => {
	it.each(['index.html', 'src/components/Hero.tsx', 'public/.well-known/security.txt'])('accepts %s', (path) => {
		expect(isSafeSeedPath(path)).toBe(true);
	});

	it.each([
		'',
		'/etc/passwd',
		'../outside.txt',
		'src/../../x',
		'a//b',
		'./a',
		'a\\b',
		'.git/config',
		'.think/space.json',
		'.dev.vars',
		'x'.repeat(513),
	])('rejects %s', (path) => {
		expect(isSafeSeedPath(path)).toBe(false);
	});
});

describe('parseBundle', () => {
	it('rejects a malformed document', () => {
		expect(() => parseBundle('{"files":[{"path":"a.txt"}]}')).toThrow('Template snapshot is malformed');
		expect(() => parseBundle('[]')).toThrow('Template snapshot is malformed');
	});

	it('rejects an unsafe path', () => {
		const json = JSON.stringify({ files: [{ path: '../x', encoding: 'utf8', content: '' }] });
		expect(() => parseBundle(json)).toThrow('Template snapshot has an unsafe path: ../x');
	});
});

describe('bundleToFiles', () => {
	it('returns the kept files byte for byte', () => {
		const encoder = new TextEncoder();
		const files = [
			{ path: '/index.html', bytes: encoder.encode('<h1>Hi</h1>') },
			{ path: '/.env', bytes: encoder.encode('SECRET=1') },
			{ path: '/logo.png', bytes: new Uint8Array([0x89, 0x50, 0x00, 0xff]) },
		];
		const snapshot = buildSnapshot(files);
		if (!snapshot.ok) throw new Error(snapshot.error);
		expect(bundleToFiles(snapshot.bundle)).toEqual([
			{ path: 'index.html', bytes: files[0].bytes },
			{ path: 'logo.png', bytes: files[2].bytes },
		]);
	});

	it('refuses an unsafe path', () => {
		expect(() => bundleToFiles({ files: [{ path: '../x', encoding: 'utf8', content: '' }] })).toThrow(
			'Template snapshot has an unsafe path: ../x',
		);
	});
});
