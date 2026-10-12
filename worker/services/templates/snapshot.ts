/**
 * Template snapshots: the frozen copy of an app's files that a template
 * version publishes. Pure functions, so every rule is unit-tested.
 */

import { base64ToUint8Array, uint8ArrayToBase64 } from '../../utils/encoding';

export const MAX_TEMPLATE_FILES = 500;
export const MAX_TEMPLATE_BYTES = 10 * 1024 * 1024;
export const TEMPLATE_LIMIT_ERROR = 'Templates can have at most 500 files and 10 MB';
export const EMPTY_TEMPLATE_ERROR = 'Your app has no files to publish';

/** One file with its exact bytes. Paths read from git start with `/`. */
export interface TreeFile {
	path: string;
	bytes: Uint8Array;
}

export interface BundleFile {
	path: string;
	encoding: 'utf8' | 'base64';
	content: string;
}

/** The `files.json` document stored for each template version. */
export interface TemplateBundle {
	files: BundleFile[];
}

export type SnapshotResult =
	| { ok: true; bundle: TemplateBundle; fileCount: number; totalBytes: number }
	| { ok: false; error: string };

const EXCLUDED_SEGMENTS = new Set(['.git', '.think', '.afs']);

const SECRET_PATTERNS: readonly RegExp[] = [
	/-----BEGIN [A-Z ]*PRIVATE KEY-----/,
	/\bAKIA[0-9A-Z]{16}\b/,
	/\bghp_[A-Za-z0-9]{36}\b/,
	/\bgithub_pat_[A-Za-z0-9_]{22,}/,
	/\bxox[abprs]-[A-Za-z0-9-]{10,}/,
	/\b[sr]k_live_[A-Za-z0-9]{16,}/,
	/\bsk-ant-[A-Za-z0-9_-]{32,}/,
	/\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/,
	/(?:api[_-]?key|secret)[A-Za-z_]{0,40}\s*[:=]\s*["'][^"'\s]{20,}["']/i,
];

function stripLeadingSlashes(path: string): string {
	return path.replace(/^\/+/, '');
}

/** Paths that never enter a snapshot: git and agent bookkeeping, and env files. */
export function isExcludedFromSnapshot(path: string): boolean {
	const segments = stripLeadingSlashes(path).split('/');
	if (segments.some((segment) => EXCLUDED_SEGMENTS.has(segment) || segment.startsWith('.env'))) return true;
	const name = segments[segments.length - 1] ?? '';
	return name.startsWith('.dev.vars');
}

export function containsSecret(text: string): boolean {
	return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

/** The text of valid UTF-8 without NUL bytes, or null for binary content. */
export function decodeText(bytes: Uint8Array): string | null {
	try {
		const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
		return text.includes('\u0000') ? null : text;
	} catch {
		return null;
	}
}

/**
 * Filter, limit-check and secret-scan a commit's files, then encode them as a
 * bundle. Text is stored as UTF-8 and everything else as base64, so binary
 * assets keep their exact bytes.
 */
export function buildSnapshot(files: TreeFile[]): SnapshotResult {
	const kept = files
		.filter((file) => !isExcludedFromSnapshot(file.path))
		.sort((a, b) => a.path.localeCompare(b.path));
	const totalBytes = kept.reduce((sum, file) => sum + file.bytes.byteLength, 0);
	if (kept.length > MAX_TEMPLATE_FILES || totalBytes > MAX_TEMPLATE_BYTES) {
		return { ok: false, error: TEMPLATE_LIMIT_ERROR };
	}
	if (kept.length === 0) {
		return { ok: false, error: EMPTY_TEMPLATE_ERROR };
	}

	const bundleFiles: BundleFile[] = [];
	for (const file of kept) {
		const path = stripLeadingSlashes(file.path);
		const text = decodeText(file.bytes);
		if (text === null) {
			bundleFiles.push({ path, encoding: 'base64', content: uint8ArrayToBase64(file.bytes) });
			continue;
		}
		if (containsSecret(text)) {
			return { ok: false, error: `${path} looks like it contains a secret key; remove it and redeploy` };
		}
		bundleFiles.push({ path, encoding: 'utf8', content: text });
	}
	return { ok: true, bundle: { files: bundleFiles }, fileCount: bundleFiles.length, totalBytes };
}

/** Whether a bundle path is safe to write into a new workspace. */
export function isSafeSeedPath(path: string): boolean {
	if (path.length === 0 || path.length > 512) return false;
	if (path.startsWith('/') || path.includes('\\') || path.includes('\u0000')) return false;
	const segments = path.split('/');
	if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return false;
	return !isExcludedFromSnapshot(path);
}

function isBundleFile(value: unknown): value is BundleFile {
	if (typeof value !== 'object' || value === null) return false;
	const file = value as Record<string, unknown>;
	return (
		typeof file.path === 'string' &&
		typeof file.content === 'string' &&
		(file.encoding === 'utf8' || file.encoding === 'base64')
	);
}

/** Parse a stored `files.json`, validating every path again before it is used. */
export function parseBundle(json: string): TreeFile[] {
	const parsed: unknown = JSON.parse(json);
	const candidate = typeof parsed === 'object' && parsed !== null ? (parsed as { files?: unknown }).files : undefined;
	if (!Array.isArray(candidate)) throw new Error('Template snapshot is malformed');
	const entries: unknown[] = candidate;
	if (!entries.every(isBundleFile)) throw new Error('Template snapshot is malformed');
	if (entries.length > MAX_TEMPLATE_FILES) throw new Error(TEMPLATE_LIMIT_ERROR);

	return entries.map((file) => {
		if (!isSafeSeedPath(file.path)) {
			throw new Error(`Template snapshot has an unsafe path: ${file.path}`);
		}
		const bytes = file.encoding === 'base64' ? base64ToUint8Array(file.content) : new TextEncoder().encode(file.content);
		return { path: file.path, bytes };
	});
}
