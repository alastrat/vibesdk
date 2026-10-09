/**
 * Design extraction for reference pages. The script runs inside the page and
 * reads computed styles, so colors and fonts from external stylesheets and
 * utility-class sites are seen. Its output is untrusted page data, so
 * `normalizeReferenceDesign` validates and caps every field.
 */

import type { ReferenceDesign } from './types';

export const REFERENCE_EXTRACT_SCRIPT = `(() => {
	const isVisible = (el) => {
		const rect = el.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) return false;
		const style = getComputedStyle(el);
		return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0;
	};
	// A 1x1 canvas resolves any CSS color syntax (rgb, oklch, lab, color()) that computed styles may return.
	const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
	const hexCache = new Map();
	const toHex = (value) => {
		if (!ctx || !value) return null;
		if (hexCache.has(value)) return hexCache.get(value);
		ctx.clearRect(0, 0, 1, 1);
		ctx.fillStyle = '#000';
		ctx.fillStyle = value;
		ctx.fillRect(0, 0, 1, 1);
		const data = ctx.getImageData(0, 0, 1, 1).data;
		const hex = data[3] === 0 ? null : '#' + [data[0], data[1], data[2]].map((n) => n.toString(16).padStart(2, '0')).join('');
		hexCache.set(value, hex);
		return hex;
	};
	const firstFamily = (el) => (el ? getComputedStyle(el).fontFamily.split(',')[0].replace(/["']/g, '').trim() : '');
	const clean = (text) => (text || '').replace(/\\s+/g, ' ').trim();

	const elements = Array.from(document.body ? document.body.querySelectorAll('*') : []).slice(0, 4000).filter(isVisible);
	const counts = new Map();
	for (const el of elements) {
		const style = getComputedStyle(el);
		for (const value of [style.color, style.backgroundColor]) {
			const hex = toHex(value);
			if (hex) counts.set(hex, (counts.get(hex) || 0) + 1);
		}
	}
	const palette = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8).map((entry) => entry[0]);

	const heading = document.querySelector('h1') || document.querySelector('h2');
	const buttonEl = Array.from(document.querySelectorAll('button, [role="button"], a[class*="btn"], a[class*="button"]')).find(isVisible) || null;
	const headings = ['h1', 'h2', 'h3'].map((tag) => {
		const el = document.querySelector(tag);
		if (!el) return null;
		const style = getComputedStyle(el);
		return { tag, size: style.fontSize, weight: style.fontWeight };
	}).filter(Boolean);
	const button = buttonEl ? (() => {
		const style = getComputedStyle(buttonEl);
		return { background: toHex(style.backgroundColor) || 'transparent', color: toHex(style.color) || '', radius: style.borderRadius };
	})() : null;
	const nav = Array.from(document.querySelectorAll('header a, nav a')).filter(isVisible).map((a) => clean(a.textContent))
		.filter((text, index, all) => text.length > 0 && text.length <= 40 && all.indexOf(text) === index).slice(0, 12);

	const root = document.querySelector('main') || document.body;
	let candidates = root ? Array.from(root.querySelectorAll('section')) : [];
	if (candidates.length < 2 && root) {
		// Skip single-child wrappers such as body > #root > div so the page's real blocks are the candidates.
		let container = root;
		for (let depth = 0; depth < 4; depth++) {
			const visibleChildren = Array.from(container.children).filter(isVisible);
			if (visibleChildren.length !== 1 || visibleChildren[0].children.length === 0) break;
			container = visibleChildren[0];
		}
		candidates = Array.from(container.children);
	}
	const blocks = candidates.filter((el) => isVisible(el) && el.getBoundingClientRect().height > 120);
	const topLevel = blocks.filter((el) => !blocks.some((other) => other !== el && other.contains(el))).slice(0, 15);
	const columnsOf = (el) => {
		const nodes = [el].concat(Array.from(el.querySelectorAll('*')).slice(0, 200));
		for (const node of nodes) {
			const style = getComputedStyle(node);
			if (style.display.includes('grid')) {
				const count = style.gridTemplateColumns.split(' ').filter((part) => part && part !== 'none').length;
				if (count > 1) return Math.min(count, 6);
			}
			if (style.display.includes('flex') && !style.flexDirection.startsWith('column')) {
				const visibleChildren = Array.from(node.children).filter(isVisible).length;
				if (visibleChildren > 1) return Math.min(visibleChildren, 6);
			}
		}
		return 1;
	};
	const sections = topLevel.map((el) => ({
		heading: clean((el.querySelector('h1, h2, h3') || {}).textContent).slice(0, 120),
		columns: columnsOf(el),
		hasImage: Boolean(el.querySelector('img, picture, video, svg')),
	}));
	const copy = clean(topLevel.map((el) => el.innerText).join(' ')).slice(0, 6000);
	const images = Array.from(document.images).filter(isVisible).map((img) => img.currentSrc || img.src)
		.filter((src, index, all) => /^https?:/.test(src) && all.indexOf(src) === index).slice(0, 12);

	return {
		title: clean(document.title).slice(0, 200),
		palette,
		fonts: { body: firstFamily(document.body), headings: firstFamily(heading), buttons: firstFamily(buttonEl) },
		headings,
		button,
		nav,
		sections,
		copy,
		images,
	};
})()`;

const HEX = /^#[0-9a-f]{6}$/;
const MAX_IMAGE_URL_LENGTH = 2000;

function text(value: unknown, max: number): string {
	return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function list(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
	return isRecord(value) ? value : {};
}

export function normalizeReferenceDesign(raw: unknown): ReferenceDesign {
	const data = record(raw);
	const fonts = record(data.fonts);
	const button = record(data.button);
	return {
		title: text(data.title, 200),
		palette: list(data.palette)
			.map((color) => (typeof color === 'string' ? color.trim().toLowerCase() : ''))
			.filter((color) => HEX.test(color))
			.slice(0, 8),
		fonts: { body: text(fonts.body, 80), headings: text(fonts.headings, 80), buttons: text(fonts.buttons, 80) },
		headings: list(data.headings)
			.map(record)
			.map((h) => ({ tag: text(h.tag, 4), size: text(h.size, 16), weight: text(h.weight, 8) }))
			.filter((h) => /^h[1-6]$/.test(h.tag))
			.slice(0, 3),
		button: isRecord(data.button) ? { background: text(button.background, 32), color: text(button.color, 32), radius: text(button.radius, 32) } : null,
		nav: list(data.nav).map((label) => text(label, 40)).filter((label) => label.length > 0).slice(0, 12),
		sections: list(data.sections)
			.map(record)
			.map((s) => ({
				heading: text(s.heading, 120),
				columns: Math.min(6, Math.max(1, Math.round(Number(s.columns) || 1))),
				hasImage: s.hasImage === true,
			}))
			.slice(0, 15),
		copy: text(data.copy, 6000),
		images: list(data.images)
			.map((url) => (typeof url === 'string' ? url.trim() : ''))
			.filter((url) => url.length <= MAX_IMAGE_URL_LENGTH && /^https?:\/\//.test(url))
			.slice(0, 12),
	};
}
