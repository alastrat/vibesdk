import { describe, expect, it } from 'vitest';
import type { ReferenceDesign } from '../../services/browser-capture/types';
import {
	describeReferenceSummary,
	extractReferenceUrls,
	formatReferenceDigest,
	parseIpv6Groups,
	referenceHost,
	referenceShotLabel,
	validateReferenceUrl,
	type ReferenceOutcome,
} from './references';

const DESIGN: ReferenceDesign = {
	title: 'Stripe | Financial infrastructure',
	palette: ['#0a2540', '#635bff', '#ffffff'],
	fonts: { body: 'Inter', headings: 'Playfair Display', buttons: 'Inter' },
	headings: [{ tag: 'h1', size: '56px', weight: '700' }],
	button: { background: '#635bff', color: '#ffffff', radius: '4px' },
	nav: ['Products', 'Pricing'],
	sections: [
		{ heading: 'Grow your revenue', columns: 2, hasImage: true },
		{ heading: '', columns: 6, hasImage: false },
	],
	copy: 'Financial infrastructure to grow your revenue.',
	images: ['https://images.example.com/hero.png'],
};

const CAPTURED: ReferenceOutcome = {
	url: 'https://stripe.com',
	host: 'stripe.com',
	ok: true,
	captureId: 'c1',
	shots: [
		{ kind: 'desktop-top', r2Key: 'screenshots/app/ref-c1-desktop-top.jpg' },
		{ kind: 'mobile-top', r2Key: 'screenshots/app/ref-c1-mobile-top.jpg' },
	],
	design: DESIGN,
};

describe('extractReferenceUrls', () => {
	it('finds URLs and strips trailing punctuation, brackets and markdown', () => {
		expect(
			extractReferenceUrls('Like https://stripe.com, and [this](https://linear.app/features). Also <https://vercel.com>!').urls,
		).toEqual(['https://stripe.com', 'https://linear.app/features', 'https://vercel.com']);
	});

	it('keeps balanced parentheses that belong to the URL', () => {
		expect(extractReferenceUrls('see https://en.wikipedia.org/wiki/Swiss_(design) please').urls).toEqual([
			'https://en.wikipedia.org/wiki/Swiss_(design)',
		]);
	});

	it('removes duplicates and keeps the first three in order', () => {
		const result = extractReferenceUrls('https://a.com https://b.com https://a.com https://c.com https://d.com https://e.com');
		expect(result.urls).toEqual(['https://a.com', 'https://b.com', 'https://c.com']);
		expect(result.skipped).toEqual(['https://d.com', 'https://e.com']);
	});

	it('finds nothing in plain text', () => {
		expect(extractReferenceUrls('Build a store called "Trailhead Supply".')).toEqual({ urls: [], skipped: [] });
	});
});

describe('validateReferenceUrl', () => {
	it('accepts public http and https pages', () => {
		expect(validateReferenceUrl('https://stripe.com/pricing').ok).toBe(true);
		expect(validateReferenceUrl('http://example.com').ok).toBe(true);
	});

	it.each([
		['ftp://example.com', 'not-http'],
		['javascript:alert(1)', 'not-http'],
		['not a url', 'invalid'],
		['http://localhost:3000', 'private-address'],
		['http://app.localhost', 'private-address'],
		['http://127.0.0.1', 'private-address'],
		['http://10.1.2.3', 'private-address'],
		['http://172.20.0.1', 'private-address'],
		['http://192.168.1.10', 'private-address'],
		['http://169.254.169.254/latest/meta-data', 'private-address'],
		['http://100.64.0.1', 'private-address'],
		['http://0.0.0.0', 'private-address'],
		['http://2130706433', 'private-address'],
		['http://[::1]', 'private-address'],
		['http://[fd00:ec2::254]', 'private-address'],
		['http://[fe80::1]', 'private-address'],
		['http://[::ffff:127.0.0.1]', 'private-address'],
		['https://estori.app', 'estori-host'],
		['https://preview.estori.app/space/x/preview/main/', 'estori-host'],
		// Security fix 1: trailing-dot bypass
		['http://localhost.', 'private-address'],
		['http://localhost.:3000/x', 'private-address'],
		['http://LocalHost.', 'private-address'],
		['http://foo.localhost.', 'private-address'],
		['http://estori.app.', 'estori-host'],
		['http://www.estori.app.', 'estori-host'],
		['http://estori.app%2e', 'estori-host'],
		['http://localhost。', 'private-address'],
		['http://localhost..', 'private-address'],
		// Security fix 2: embedded-IPv4 IPv6 bypass
		['http://[::127.0.0.1]', 'private-address'],
		['http://[::a00:1]', 'private-address'],
		['http://[::a9fe:a9fe]', 'private-address'],
		['http://[::ffff:0:127.0.0.1]', 'private-address'],
		['http://[64:ff9b::a9fe:a9fe]', 'private-address'],
		['http://[2002:a9fe:a9fe::]', 'private-address'],
		// Normalized IPv4 forms
		['http://0x7f.1', 'private-address'],
		['http://017700000001', 'private-address'],
		['http://127.1', 'private-address'],
		// Uppercase
		['http://LOCALHOST', 'private-address'],
		// Userinfo with private address
		['http://evil.com@127.0.0.1', 'private-address'],
	])('rejects %s as %s', (url, reason) => {
		expect(validateReferenceUrl(url)).toEqual({ ok: false, reason });
	});

	it('does not reject public addresses that merely look similar', () => {
		expect(validateReferenceUrl('http://172.32.0.1').ok).toBe(true);
		expect(validateReferenceUrl('https://notestori.app').ok).toBe(true);
	});

	it('accepts IPv4-mapped public address', () => {
		expect(validateReferenceUrl('http://[::ffff:8.8.8.8]').ok).toBe(true);
	});

	it('accepts userinfo with public domain', () => {
		expect(validateReferenceUrl('http://estori.app@example.com').ok).toBe(true);
	});

	it('accepts public IPv6 addresses (middle and trailing ::)', () => {
		expect(validateReferenceUrl('http://[2001:4860:4860::8888]').ok).toBe(true);
		expect(validateReferenceUrl('http://[2606:4700::1111]').ok).toBe(true);
		expect(validateReferenceUrl('http://[2001:db8::]').ok).toBe(true);
		expect(validateReferenceUrl('http://[1::]').ok).toBe(true);
		expect(validateReferenceUrl('http://[2001:a18:1:2:3:4:5:6]').ok).toBe(true);
		expect(validateReferenceUrl('http://[fd::1]').ok).toBe(true);
		expect(validateReferenceUrl('http://[fe8::1]').ok).toBe(true);
	});

	it('rejects private IPv6 ranges parsed correctly', () => {
		expect(validateReferenceUrl('http://[fd12:3456::1]')).toEqual({ ok: false, reason: 'private-address' });
		expect(validateReferenceUrl('http://[fe80::1]')).toEqual({ ok: false, reason: 'private-address' });
		expect(validateReferenceUrl('http://[64:ff9b::a9fe:a9fe]')).toEqual({ ok: false, reason: 'private-address' });
		expect(validateReferenceUrl('http://[2002:a9fe:a9fe::]')).toEqual({ ok: false, reason: 'private-address' });
	});
});

describe('IPv6 group parser', () => {
	it('expands :: correctly at any position', () => {
		expect(parseIpv6Groups('2001:db8::1')).toEqual([0x2001, 0xdb8, 0, 0, 0, 0, 0, 1]);
	});
});

describe('reference wording', () => {
	it('names the host without www', () => {
		expect(referenceHost('https://www.stripe.com/pricing')).toBe('stripe.com');
		expect(referenceHost('not a url')).toBe('not a url');
	});

	it('labels each screenshot', () => {
		expect(referenceShotLabel('stripe.com', 'desktop-middle')).toBe('Reference stripe.com: desktop, middle');
		expect(referenceShotLabel('stripe.com', 'mobile-top')).toBe('Reference stripe.com: phone, top');
	});

	it('writes a digest the model can follow', () => {
		expect(formatReferenceDigest(CAPTURED, 1)).toBe(
			[
				'Reference 1: https://stripe.com ("Stripe | Financial infrastructure")',
				'Palette (most used first): #0a2540, #635bff, #ffffff',
				'Fonts: body "Inter", headings "Playfair Display", buttons "Inter"',
				'Headings: h1 56px/700',
				'Buttons: background #635bff, text #ffffff, radius 4px',
				'Nav: Products, Pricing',
				'Sections, top to bottom:',
				'  1. Grow your revenue: 2 columns, image',
				'  2. (no heading): 6 columns',
				"Copy (for structure; reuse only if the user says the site is theirs): Financial infrastructure to grow your revenue.",
				'Image URLs (only if the user says the site is theirs): https://images.example.com/hero.png',
				'Screenshots follow: desktop, top; phone, top.',
			].join('\n'),
		);
	});

	it('tells the model when a reference could not be captured', () => {
		const failed: ReferenceOutcome = { url: 'https://x.com', host: 'x.com', ok: false, reason: 'HTTP 403' };
		expect(formatReferenceDigest(failed, 2)).toBe(
			"Reference 2: https://x.com could not be captured (HTTP 403); work from the user's description.",
		);
	});

	it('summarizes a capture for the reference card', () => {
		expect(describeReferenceSummary(DESIGN)).toBe('Desktop + mobile · 3 colors · Inter / Playfair Display · 2 sections');
		expect(describeReferenceSummary({ ...DESIGN, fonts: { body: 'Inter', headings: 'Inter', buttons: 'Inter' } })).toBe(
			'Desktop + mobile · 3 colors · Inter · 2 sections',
		);
	});

	it('uses singular form for 1 color and 1 section', () => {
		expect(describeReferenceSummary({ ...DESIGN, palette: ['#ffffff'], sections: [{ heading: 'Hero', columns: 1, hasImage: false }] })).toBe(
			'Desktop + mobile · 1 color · Inter / Playfair Display · 1 section',
		);
	});

	it('handles empty body font in summary', () => {
		expect(describeReferenceSummary({ ...DESIGN, fonts: { body: '', headings: 'Playfair Display', buttons: 'Inter' } })).toBe(
			'Desktop + mobile · 3 colors · Playfair Display · 2 sections',
		);
	});
});
