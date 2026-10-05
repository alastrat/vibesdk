import { describe, expect, it } from 'vitest';
import themeCss from '../styles/estori-theme.css?raw';

type Palette = Record<string, string>;

const LIGHT_SELECTOR = ":root[data-theme='estori']";
const DARK_SELECTOR = ":root[data-theme='estori'][data-mode='dark']";

/** Reads `--estori-<name>: #rrggbb;` declarations from the block opened by `selector {`. */
function readPalette(selector: string): Palette {
	const start = themeCss.indexOf(`${selector} {`);
	if (start === -1) {
		throw new Error(`Palette block not found: ${selector}`);
	}
	const body = themeCss.slice(start, themeCss.indexOf('}', start));
	return Object.fromEntries(
		[...body.matchAll(/--estori-([a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map(
			([, name, hex]) => [name, hex.toLowerCase()],
		),
	);
}

function channel(hex: string, offset: number): number {
	const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
	return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
	return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
}

function contrast(a: string, b: string): number {
	const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (high + 0.05) / (low + 0.05);
}

const BODY_TEXT = 4.5;
const LARGE_OR_UI = 3;

const PAIRS: ReadonlyArray<readonly [string, string, number]> = [
	['text-strong', 'canvas', BODY_TEXT],
	['text-default', 'canvas', BODY_TEXT],
	['text-default', 'surface', BODY_TEXT],
	['text-default', 'elevated', BODY_TEXT],
	['text-default', 'recessed', BODY_TEXT],
	['text-default', 'selected-bg', BODY_TEXT],
	['text-subtle', 'canvas', BODY_TEXT],
	['text-subtle', 'surface', BODY_TEXT],
	['text-subtle', 'elevated', BODY_TEXT],
	['text-subtle', 'recessed', BODY_TEXT],
	['link', 'canvas', BODY_TEXT],
	['link', 'surface', BODY_TEXT],
	['link', 'elevated', BODY_TEXT],
	['link', 'selected-bg', BODY_TEXT],
	['on-action', 'action', BODY_TEXT],
	['on-action', 'action-hover', BODY_TEXT],
	['topbar-text', 'topbar', BODY_TEXT],
	['highlight', 'canvas', LARGE_OR_UI],
	['logo-dot', 'topbar', LARGE_OR_UI],
];

const light = readPalette(LIGHT_SELECTOR);
const dark: Palette = { ...light, ...readPalette(DARK_SELECTOR) };

describe('Estori palette', () => {
	it('never uses the excluded navy #0B1021', () => {
		expect(themeCss.toLowerCase()).not.toContain('#0b1021');
	});
});

describe.each([
	['light', light],
	['dark', dark],
] as const)('Estori palette contrast (%s)', (_mode, palette) => {
	it.each(PAIRS)('%s on %s meets %d:1', (fg, bg, minimum) => {
		const foreground = palette[fg];
		const background = palette[bg];
		if (!foreground || !background) {
			throw new Error(`Missing --estori-${fg} or --estori-${bg}`);
		}
		expect(contrast(foreground, background)).toBeGreaterThanOrEqual(minimum);
	});
});
