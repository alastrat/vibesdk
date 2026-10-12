import { describe, expect, it } from 'vitest';
import {
	READ_FAILED_MESSAGE,
	SAVE_FAILED_MESSAGE,
	SCREENSHOT_FAILED_MESSAGE,
	TemplateSubmissionError,
	submitTemplateVersion,
	templateObjectKeys,
	type ShotDevice,
	type SubmissionDeps,
	type SubmissionRecord,
	type TemplateObjectStore,
} from './submit';
import type { TreeFile } from './snapshot';

const encoder = new TextEncoder();
const FILES: TreeFile[] = [{ path: '/index.html', bytes: encoder.encode('<h1>Shop</h1>') }];
const IDS = { templateId: 'tpl1', versionId: 'ver1' };
const SOURCE = { commit: 'abc123', previewUrl: 'https://preview.example/app/?t=x' };
const JPEG = new Uint8Array([0xff, 0xd8, 0xff]);

class MemoryStore implements TemplateObjectStore {
	readonly objects = new Map<string, string | Uint8Array>();

	constructor(private readonly failOnKey?: string) {}

	async put(key: string, body: string | Uint8Array): Promise<void> {
		if (key === this.failOnKey) throw new Error('R2 unavailable');
		this.objects.set(key, body);
	}

	async delete(keys: string[]): Promise<void> {
		for (const key of keys) this.objects.delete(key);
	}
}

function setup(overrides: Partial<SubmissionDeps> = {}) {
	const recorded: SubmissionRecord[] = [];
	const store = overrides.store instanceof MemoryStore ? overrides.store : new MemoryStore();
	const deps: SubmissionDeps = {
		readTree: async () => FILES,
		captureShot: async () => JPEG,
		recordVersion: async (record) => {
			recorded.push(record);
		},
		...overrides,
		store,
	};
	return { deps, recorded, store };
}

describe('submitTemplateVersion', () => {
	it('stores the snapshot and both screenshots, then records the version', async () => {
		const { deps, recorded, store } = setup();
		const record = await submitTemplateVersion(deps, SOURCE, IDS);
		const keys = templateObjectKeys(IDS);

		expect(keys).toEqual({
			snapshotKey: 'templates/tpl1/ver1/files.json',
			desktopShotKey: 'templates/tpl1/ver1/desktop.jpg',
			mobileShotKey: 'templates/tpl1/ver1/mobile.jpg',
		});
		expect(JSON.parse(String(store.objects.get(keys.snapshotKey)))).toEqual({
			files: [{ path: 'index.html', encoding: 'utf8', content: '<h1>Shop</h1>' }],
		});
		expect(store.objects.get(keys.desktopShotKey)).toEqual(JPEG);
		expect(store.objects.get(keys.mobileShotKey)).toEqual(JPEG);
		expect(record).toEqual({ ...IDS, ...keys, sourceCommit: 'abc123', fileCount: 1, totalBytes: 13 });
		expect(recorded).toEqual([record]);
	});

	it('captures the desktop and phone views of the deployed preview', async () => {
		const shots: Array<[string, ShotDevice]> = [];
		const { deps } = setup({
			captureShot: async (url, device) => {
				shots.push([url, device]);
				return JPEG;
			},
		});
		await submitTemplateVersion(deps, SOURCE, IDS);
		expect(shots).toEqual([
			[SOURCE.previewUrl, 'desktop'],
			[SOURCE.previewUrl, 'phone'],
		]);
	});

	it('retries a failed capture once', async () => {
		let calls = 0;
		const { deps } = setup({
			captureShot: async () => {
				calls++;
				if (calls === 1) throw new Error('timeout');
				return JPEG;
			},
		});
		await expect(submitTemplateVersion(deps, SOURCE, IDS)).resolves.toMatchObject({ fileCount: 1 });
		expect(calls).toBe(3);
	});

	it('fails with the capture message and leaves nothing behind when a capture fails twice', async () => {
		const { deps, recorded, store } = setup({
			captureShot: async () => {
				throw new Error('blank page');
			},
		});
		const error = await submitTemplateVersion(deps, SOURCE, IDS).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(TemplateSubmissionError);
		expect(error).toMatchObject({ message: SCREENSHOT_FAILED_MESSAGE, status: 400 });
		expect(store.objects.size).toBe(0);
		expect(recorded).toEqual([]);
	});

	it('refuses files that look like secrets before capturing anything', async () => {
		const devices: ShotDevice[] = [];
		const { deps, recorded } = setup({
			readTree: async () => [...FILES, { path: '/src/keys.ts', bytes: encoder.encode('const k = "AKIA' + 'ABCDEFGHIJKLMNOP";') }],
			captureShot: async (_url, device) => {
				devices.push(device);
				return JPEG;
			},
		});
		await expect(submitTemplateVersion(deps, SOURCE, IDS)).rejects.toMatchObject({
			status: 400,
			message: 'src/keys.ts looks like it contains a secret key; remove it and redeploy',
		});
		expect(devices).toEqual([]);
		expect(recorded).toEqual([]);
	});

	it('removes stored objects and records nothing when a write fails', async () => {
		const { deps, recorded, store } = setup({ store: new MemoryStore('templates/tpl1/ver1/mobile.jpg') });
		await expect(submitTemplateVersion(deps, SOURCE, IDS)).rejects.toMatchObject({
			status: 500,
			message: SAVE_FAILED_MESSAGE,
		});
		expect(store.objects.size).toBe(0);
		expect(recorded).toEqual([]);
	});

	it('removes stored objects when recording the version fails', async () => {
		const { deps, store } = setup({
			recordVersion: async () => {
				throw new Error('D1 error');
			},
		});
		await expect(submitTemplateVersion(deps, SOURCE, IDS)).rejects.toMatchObject({
			status: 500,
			message: SAVE_FAILED_MESSAGE,
		});
		expect(store.objects.size).toBe(0);
	});

	it('reports a read failure without touching storage', async () => {
		const { deps, store } = setup({
			readTree: async () => {
				throw new Error('missing object');
			},
		});
		await expect(submitTemplateVersion(deps, SOURCE, IDS)).rejects.toMatchObject({
			status: 500,
			message: READ_FAILED_MESSAGE,
		});
		expect(store.objects.size).toBe(0);
	});
});
