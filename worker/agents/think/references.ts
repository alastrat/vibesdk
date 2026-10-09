/**
 * Reference URLs in a user's message: which ones to capture, which are safe
 * to open, and how a capture is described to the model and in the chat.
 */

import type { ReferenceDesign, ReferenceShotKind } from '../../services/browser-capture/types';

export const MAX_REFERENCE_URLS = 3;

export interface ExtractedReferenceUrls {
	urls: string[];
	skipped: string[];
}

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi;
const TRAILING = new Set(['.', ',', ';', ':', '!', '?', ')', ']', '}', '>', "'", '"', '*', '_']);

function count(text: string, char: string): number {
	return text.split(char).length - 1;
}

/** Drops trailing punctuation, keeping a closing bracket the URL itself opened. */
function trimUrl(raw: string): string {
	let url = raw;
	while (url.length > 0 && TRAILING.has(url[url.length - 1])) {
		const last = url[url.length - 1];
		if (last === ')' && count(url, '(') >= count(url, ')')) break;
		if (last === ']' && count(url, '[') >= count(url, ']')) break;
		url = url.slice(0, -1);
	}
	return url;
}

export function extractReferenceUrls(text: string, max = MAX_REFERENCE_URLS): ExtractedReferenceUrls {
	const found: string[] = [];
	for (const match of text.matchAll(URL_PATTERN)) {
		const url = trimUrl(match[0]);
		if (url && !found.includes(url)) found.push(url);
	}
	return { urls: found.slice(0, max), skipped: found.slice(max) };
}

export type UrlRejection = 'not-http' | 'private-address' | 'estori-host' | 'invalid';

function ipv4Octets(host: string): number[] | null {
	const parts = host.split('.');
	if (parts.length !== 4) return null;
	const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
	return octets.every((o) => o >= 0 && o <= 255) ? octets : null;
}

function isPrivateIpv4(octets: number[]): boolean {
	const [a, b] = octets;
	return (
		a === 0 ||
		a === 10 ||
		a === 127 ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168) ||
		(a === 100 && b >= 64 && b <= 127)
	);
}

function isPrivateIpv6(host: string): boolean {
	if (host === '::' || host === '::1') return true;
	if (/^f[cd][0-9a-f]{0,2}:/.test(host)) return true;
	if (/^fe[89ab][0-9a-f]?:/.test(host)) return true;
	const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
	if (mapped) {
		const high = parseInt(mapped[1], 16);
		const low = parseInt(mapped[2], 16);
		return isPrivateIpv4([high >> 8, high & 255, low >> 8, low & 255]);
	}
	const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(host);
	if (dotted) {
		const octets = ipv4Octets(dotted[1]);
		return octets ? isPrivateIpv4(octets) : false;
	}
	return false;
}

/** Only public web pages are captured; Estori's own hosts and private networks never are. */
export function validateReferenceUrl(raw: string): { ok: true; url: URL } | { ok: false; reason: UrlRejection } {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return { ok: false, reason: 'invalid' };
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, reason: 'not-http' };
	const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
	if (host === 'estori.app' || host.endsWith('.estori.app')) return { ok: false, reason: 'estori-host' };
	if (host === 'localhost' || host.endsWith('.localhost')) return { ok: false, reason: 'private-address' };
	const octets = ipv4Octets(host);
	if (octets && isPrivateIpv4(octets)) return { ok: false, reason: 'private-address' };
	if (host.includes(':') && isPrivateIpv6(host)) return { ok: false, reason: 'private-address' };
	return { ok: true, url };
}

export function referenceHost(raw: string): string {
	try {
		return new URL(raw).hostname.replace(/^www\./, '');
	} catch {
		return raw;
	}
}

export interface CapturedReference {
	url: string;
	host: string;
	ok: true;
	captureId: string;
	shots: { kind: ReferenceShotKind; r2Key: string }[];
	design: ReferenceDesign;
}

export interface FailedReference {
	url: string;
	host: string;
	ok: false;
	reason: string;
}

export type ReferenceOutcome = CapturedReference | FailedReference;

const SHOT_LABELS: Record<ReferenceShotKind, string> = {
	'desktop-top': 'desktop, top',
	'desktop-middle': 'desktop, middle',
	'desktop-lower': 'desktop, lower',
	'mobile-top': 'phone, top',
};

export function referenceShotLabel(host: string, kind: ReferenceShotKind): string {
	return `Reference ${host}: ${SHOT_LABELS[kind]}`;
}

/** The text the model reads for one reference, numbered from 1. */
export function formatReferenceDigest(outcome: ReferenceOutcome, index: number): string {
	if (!outcome.ok) {
		return `Reference ${index}: ${outcome.url} could not be captured (${outcome.reason}); work from the user's description.`;
	}
	const d = outcome.design;
	const lines = [
		`Reference ${index}: ${outcome.url}${d.title ? ` ("${d.title}")` : ''}`,
		`Palette (most used first): ${d.palette.join(', ') || 'unknown'}`,
		`Fonts: body "${d.fonts.body}", headings "${d.fonts.headings}", buttons "${d.fonts.buttons}"`,
	];
	if (d.headings.length > 0) {
		lines.push(`Headings: ${d.headings.map((h) => `${h.tag} ${h.size}/${h.weight}`).join(', ')}`);
	}
	if (d.button) {
		lines.push(`Buttons: background ${d.button.background}, text ${d.button.color}, radius ${d.button.radius}`);
	}
	if (d.nav.length > 0) lines.push(`Nav: ${d.nav.join(', ')}`);
	if (d.sections.length > 0) {
		lines.push('Sections, top to bottom:');
		d.sections.forEach((s, i) => {
			const columns = `${s.columns} column${s.columns === 1 ? '' : 's'}`;
			lines.push(`  ${i + 1}. ${s.heading || '(no heading)'}: ${columns}${s.hasImage ? ', image' : ''}`);
		});
	}
	if (d.copy) lines.push(`Copy (for structure; reuse only if the user says the site is theirs): ${d.copy}`);
	if (d.images.length > 0) {
		lines.push(`Image URLs (only if the user says the site is theirs): ${d.images.join(', ')}`);
	}
	lines.push(`Screenshots follow: ${outcome.shots.map((s) => SHOT_LABELS[s.kind]).join('; ')}.`);
	return lines.join('\n');
}

/** One line for the reference card, e.g. "Desktop + mobile · 6 colors · Inter / Playfair Display · 7 sections". */
export function describeReferenceSummary(design: ReferenceDesign): string {
	const { body, headings } = design.fonts;
	const fonts = !headings || headings === body ? body : `${body} / ${headings}`;
	const parts = ['Desktop + mobile', `${design.palette.length} colors`];
	if (fonts) parts.push(fonts);
	parts.push(`${design.sections.length} sections`);
	return parts.join(' · ');
}
