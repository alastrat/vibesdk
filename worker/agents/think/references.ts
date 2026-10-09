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

function parseIpv6Groups(host: string): number[] | null {
	const parts = host.split(':');
	const groups: number[] = [];
	let hasDoubleColon = false;
	let doubleColonIndex = -1;

	for (let i = 0; i < parts.length; i++) {
		if (parts[i] === '') {
			if (i > 0 && i < parts.length - 1 && parts[i - 1] === '') {
				if (hasDoubleColon) return null;
				hasDoubleColon = true;
				doubleColonIndex = i - 1;
			}
		} else {
			const val = parseInt(parts[i], 16);
			if (isNaN(val) || val < 0 || val > 0xffff) return null;
			groups.push(val);
		}
	}

	if (hasDoubleColon) {
		const before = groups.slice(0, doubleColonIndex);
		const after = doubleColonIndex < groups.length ? groups.slice(doubleColonIndex) : [];
		const zeros = 8 - before.length - after.length;
		if (zeros < 0) return null;
		return [...before, ...Array(zeros).fill(0), ...after];
	}

	return groups.length === 8 ? groups : null;
}

function isPrivateIpv6(host: string): boolean {
	const groups = parseIpv6Groups(host);
	if (!groups) return true;

	if (groups[0] === 0 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0 && groups[4] === 0 && groups[5] === 0 && groups[6] === 0 && groups[7] === 1) return true;
	if (groups[0] === 0 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0 && groups[4] === 0 && groups[5] === 0 && groups[6] === 0 && groups[7] === 0) return true;

	if ((groups[0] & 0xfe00) === 0xfc00) return true;
	if ((groups[0] & 0xffc0) === 0xfe80) return true;

	if (groups[0] === 0 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0 && groups[4] === 0 && groups[5] === 0) {
		const octets = [(groups[6] >> 8) & 0xff, groups[6] & 0xff, (groups[7] >> 8) & 0xff, groups[7] & 0xff];
		if (isPrivateIpv4(octets)) return true;
	}

	if (groups[0] === 0 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0 && groups[4] === 0 && groups[5] === 0xffff) {
		const octets = [(groups[6] >> 8) & 0xff, groups[6] & 0xff, (groups[7] >> 8) & 0xff, groups[7] & 0xff];
		if (isPrivateIpv4(octets)) return true;
	}

	if (groups[0] === 0 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0 && groups[4] === 0xffff && groups[5] === 0) {
		const octets = [(groups[6] >> 8) & 0xff, groups[6] & 0xff, (groups[7] >> 8) & 0xff, groups[7] & 0xff];
		if (isPrivateIpv4(octets)) return true;
	}

	if (groups[0] === 0x64 && groups[1] === 0xff9b && groups[2] === 0 && groups[3] === 0 && groups[4] === 0 && groups[5] === 0) {
		const octets = [(groups[6] >> 8) & 0xff, groups[6] & 0xff, (groups[7] >> 8) & 0xff, groups[7] & 0xff];
		if (isPrivateIpv4(octets)) return true;
	}

	if ((groups[0] & 0xff00) === 0x2000) {
		const octets = [(groups[1] >> 8) & 0xff, groups[1] & 0xff, (groups[2] >> 8) & 0xff, groups[2] & 0xff];
		if (isPrivateIpv4(octets)) return true;
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
	const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
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
	const fontList = [body, headings].filter((f) => f && f.trim());
	const uniqueFonts = [...new Set(fontList)];
	const fonts = uniqueFonts.join(' / ');
	const colorLabel = design.palette.length === 1 ? 'color' : 'colors';
	const sectionLabel = design.sections.length === 1 ? 'section' : 'sections';
	const parts = ['Desktop + mobile', `${design.palette.length} ${colorLabel}`];
	if (fonts) parts.push(fonts);
	parts.push(`${design.sections.length} ${sectionLabel}`);
	return parts.join(' · ');
}
