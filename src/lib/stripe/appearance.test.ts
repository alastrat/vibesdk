import { describe, expect, it } from 'vitest';
import themeCss from '../../styles/estori-theme.css?raw';
import { BILLING_APPEARANCE_TOKENS, billingAppearance } from './appearance';

const LIGHT_TOKENS = {
	'--estori-action': '#0062e6',
	'--estori-surface': '#ffffff',
	'--estori-text-default': '#1e2a3b',
	'--destructive': '#c0262d',
	'--font-sans': "ui-sans-serif, system-ui, 'Segoe UI', sans-serif",
	'--radius': '0.625rem',
};

const DARK_TOKENS = {
	'--estori-action': '#0062e6',
	'--estori-surface': '#1a1d22',
	'--estori-text-default': '#e6e9ef',
	'--destructive': '#ef4444',
	'--font-sans': "ui-sans-serif, system-ui, 'Segoe UI', sans-serif",
	'--radius': '0.625rem',
};

/** Reads `--estori-<name>: #rrggbb;` declarations from the block opened by `selector {`. */
function readPalette(selector: string): Record<string, string> {
	const start = themeCss.indexOf(`${selector} {`);
	if (start === -1) throw new Error(`Palette block not found: ${selector}`);
	const body = themeCss.slice(start, themeCss.indexOf('}', start));
	return Object.fromEntries([...body.matchAll(/--estori-([a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map(([, name, hex]) => [name, hex]));
}

describe('billingAppearance', () => {
	it('maps light and dark tokens to stripe variables', () => {
		expect(billingAppearance('light', LIGHT_TOKENS)).toEqual({
			theme: 'stripe',
			variables: {
				colorPrimary: '#0062e6',
				colorBackground: '#ffffff',
				colorText: '#1e2a3b',
				colorDanger: '#c0262d',
				fontFamily: "ui-sans-serif, system-ui, 'Segoe UI', sans-serif",
				borderRadius: '10px',
			},
		});
		expect(billingAppearance('dark', DARK_TOKENS)).toEqual({
			theme: 'night',
			variables: {
				colorPrimary: '#0062e6',
				colorBackground: '#1a1d22',
				colorText: '#e6e9ef',
				colorDanger: '#ef4444',
				fontFamily: "ui-sans-serif, system-ui, 'Segoe UI', sans-serif",
				borderRadius: '10px',
			},
		});
	});

	it('reads exactly the custom properties it names', () => {
		expect([...BILLING_APPEARANCE_TOKENS].sort()).toEqual(Object.keys(LIGHT_TOKENS).sort());
	});

	it('keeps pixel radii and trims what the browser returns', () => {
		const { variables } = billingAppearance('light', {
			...LIGHT_TOKENS,
			'--estori-action': '  #0062e6 ',
			'--radius': ' 6px ',
		});
		expect(variables.colorPrimary).toBe('#0062e6');
		expect(variables.borderRadius).toBe('6px');
	});

	it('takes rgb and hsl colors, which stripe accepts', () => {
		const { variables } = billingAppearance('light', {
			...LIGHT_TOKENS,
			'--estori-action': 'rgb(0, 98, 230)',
			'--estori-surface': 'hsl(0, 0%, 100%)',
		});
		expect(variables.colorPrimary).toBe('rgb(0, 98, 230)');
		expect(variables.colorBackground).toBe('hsl(0, 0%, 100%)');
	});

	it("falls back to estori's palette for a value stripe can't read", () => {
		const unreadable = {
			'--estori-action': 'oklch(0.5772 0.2324 260)',
			'--estori-surface': 'var(--color-kumo-base)',
			'--estori-text-default': '#950000cc',
			'--destructive': 'oklch(0.577 0.245 27.325)',
			'--font-sans': 'var(--font-stack)',
			'--radius': 'calc(var(--radius) + 2px)',
		};
		for (const theme of ['light', 'dark'] as const) {
			expect(billingAppearance(theme, unreadable)).toEqual(billingAppearance(theme, {}));
		}
		const { variables } = billingAppearance('light', {});
		expect(variables.colorDanger).toBe('#e7000b');
		expect(variables.borderRadius).toBe('10px');
		expect(variables.fontFamily).toContain('system-ui');
	});

	it('has fallbacks that are the estori palette', () => {
		const light = readPalette(":root[data-theme='estori']");
		const dark = readPalette(":root[data-theme='estori'][data-mode='dark']");
		expect(billingAppearance('light', {}).variables).toMatchObject({
			colorPrimary: light.action,
			colorBackground: light.surface,
			colorText: light['text-default'],
		});
		expect(billingAppearance('dark', {}).variables).toMatchObject({
			colorPrimary: light.action,
			colorBackground: dark.surface,
			colorText: dark['text-default'],
		});
	});
});
