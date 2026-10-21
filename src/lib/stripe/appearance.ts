import type { StripeAppearance } from './stripe-js';

/** The custom properties `billingAppearance` reads; the call site resolves each with `getComputedStyle`. */
export const BILLING_APPEARANCE_TOKENS = [
	'--estori-action',
	'--estori-surface',
	'--estori-text-default',
	'--destructive',
	'--font-sans',
	'--radius',
] as const;

interface Palette {
	primary: string;
	background: string;
	text: string;
	danger: string;
}

// Estori's palette from src/styles/estori-theme.css, used when a token can't be given to Stripe as it is.
// Danger is the hex of `--destructive` in light mode, which the stylesheet writes in oklch.
const PALETTE: Record<'light' | 'dark', Palette> = {
	light: { primary: '#0062e6', background: '#ffffff', text: '#1e2a3b', danger: '#e7000b' },
	dark: { primary: '#0062e6', background: '#1a1d22', text: '#e6e9ef', danger: '#ef4444' },
};

const FALLBACK_FONT = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const FALLBACK_RADIUS = '10px';
const ROOT_FONT_PX = 16;

// Stripe's color variables take hex, rgb and hsl, and refuse rgba, var() and the newer color functions.
const STRIPE_COLOR = /^(?:#(?:[0-9a-f]{3}|[0-9a-f]{6})|(?:rgb|hsl)\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*\))$/i;
const LENGTH = /^(\d*\.?\d+)(px|rem)$/;

function colorOf(value: string | undefined, fallback: string): string {
	const color = value?.trim() ?? '';
	return STRIPE_COLOR.test(color) ? color : fallback;
}

function fontOf(value: string | undefined): string {
	const font = value?.trim() ?? '';
	return font && !font.includes('var(') ? font : FALLBACK_FONT;
}

function radiusOf(value: string | undefined): string {
	const match = LENGTH.exec(value?.trim() ?? '');
	if (!match) return FALLBACK_RADIUS;
	const size = Number(match[1]);
	return match[2] === 'rem' ? `${size * ROOT_FONT_PX}px` : `${size}px`;
}

/** Stripe Elements' look from Estori's theme tokens, keyed by custom property name (see BILLING_APPEARANCE_TOKENS). */
export function billingAppearance(theme: 'light' | 'dark', tokens: Record<string, string>): StripeAppearance {
	const palette = PALETTE[theme];
	return {
		theme: theme === 'dark' ? 'night' : 'stripe',
		variables: {
			colorPrimary: colorOf(tokens['--estori-action'], palette.primary),
			colorBackground: colorOf(tokens['--estori-surface'], palette.background),
			colorText: colorOf(tokens['--estori-text-default'], palette.text),
			colorDanger: colorOf(tokens['--destructive'], palette.danger),
			fontFamily: fontOf(tokens['--font-sans']),
			borderRadius: radiusOf(tokens['--radius']),
		},
	};
}
