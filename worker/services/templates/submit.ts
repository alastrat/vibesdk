/**
 * Submitting an app as a template: snapshot the deployed commit, capture
 * desktop and phone screenshots, store them in R2, then record the version.
 * Dependencies are injected so the ordering and cleanup rules are tested.
 */

import { buildSnapshot, type TreeFile } from './snapshot';

export type ShotDevice = 'desktop' | 'phone';

export const SCREENSHOT_FAILED_MESSAGE = "Couldn't capture your site; make sure it's deployed and loads";
export const READ_FAILED_MESSAGE = "Couldn't read your app's files; try again";
export const SAVE_FAILED_MESSAGE = "Couldn't save your template; try again";

export interface TemplateObjectStore {
	put(key: string, body: string | Uint8Array, contentType: string): Promise<void>;
	delete(keys: string[]): Promise<void>;
}

export interface SubmissionSource {
	commit: string;
	previewUrl: string;
}

export interface SubmissionIds {
	templateId: string;
	versionId: string;
}

export interface SubmissionRecord extends SubmissionIds {
	sourceCommit: string;
	snapshotKey: string;
	desktopShotKey: string;
	mobileShotKey: string;
	fileCount: number;
	totalBytes: number;
}

export interface SubmissionDeps {
	readTree(commit: string): Promise<TreeFile[]>;
	captureShot(url: string, device: ShotDevice): Promise<Uint8Array>;
	store: TemplateObjectStore;
	recordVersion(record: SubmissionRecord): Promise<void>;
}

export class TemplateSubmissionError extends Error {
	constructor(
		message: string,
		readonly status: 400 | 500,
	) {
		super(message);
		this.name = 'TemplateSubmissionError';
	}
}

export function templateObjectKeys(ids: SubmissionIds) {
	const prefix = `templates/${ids.templateId}/${ids.versionId}`;
	return {
		snapshotKey: `${prefix}/files.json`,
		desktopShotKey: `${prefix}/desktop.jpg`,
		mobileShotKey: `${prefix}/mobile.jpg`,
	};
}

async function captureWithRetry(deps: SubmissionDeps, url: string, device: ShotDevice): Promise<Uint8Array> {
	try {
		return await deps.captureShot(url, device);
	} catch {
		try {
			return await deps.captureShot(url, device);
		} catch {
			throw new TemplateSubmissionError(SCREENSHOT_FAILED_MESSAGE, 400);
		}
	}
}

/**
 * Freeze one version of a template. Nothing is recorded unless every object
 * is stored; on any failure after storing begins, the objects are removed.
 */
export async function submitTemplateVersion(
	deps: SubmissionDeps,
	source: SubmissionSource,
	ids: SubmissionIds,
): Promise<SubmissionRecord> {
	let files: TreeFile[];
	try {
		files = await deps.readTree(source.commit);
	} catch {
		throw new TemplateSubmissionError(READ_FAILED_MESSAGE, 500);
	}

	const snapshot = buildSnapshot(files);
	if (!snapshot.ok) throw new TemplateSubmissionError(snapshot.error, 400);

	const desktop = await captureWithRetry(deps, source.previewUrl, 'desktop');
	const mobile = await captureWithRetry(deps, source.previewUrl, 'phone');

	const keys = templateObjectKeys(ids);
	try {
		await deps.store.put(keys.snapshotKey, JSON.stringify(snapshot.bundle), 'application/json');
		await deps.store.put(keys.desktopShotKey, desktop, 'image/jpeg');
		await deps.store.put(keys.mobileShotKey, mobile, 'image/jpeg');
		const record: SubmissionRecord = {
			...ids,
			...keys,
			sourceCommit: source.commit,
			fileCount: snapshot.fileCount,
			totalBytes: snapshot.totalBytes,
		};
		await deps.recordVersion(record);
		return record;
	} catch {
		await deps.store.delete(Object.values(keys)).catch(() => undefined);
		throw new TemplateSubmissionError(SAVE_FAILED_MESSAGE, 500);
	}
}
