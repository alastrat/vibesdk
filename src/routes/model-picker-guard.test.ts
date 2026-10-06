import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	[
		'/src/components/ThinkModelPicker.tsx',
		'/src/routes/home.tsx',
	],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('model picker: component', () => {
	it('renders nothing when no models are offered', () => {
		expect(source('/src/components/ThinkModelPicker.tsx')).toContain('if (options.length === 0) return null;');
	});

	it('shows the placeholder when no model is selected', () => {
		expect(source('/src/components/ThinkModelPicker.tsx')).toContain('placeholder="Select model"');
	});
});

describe('model picker: home prompt', () => {
	it('renders the picker on the home prompt', () => {
		expect(source('/src/routes/home.tsx')).toMatch(/<ThinkModelPicker\b/);
	});

	it('sends the chosen model only when one is set', () => {
		expect(source('/src/routes/home.tsx')).toContain(
			"const modelParam = mode === 'app' && modelId ? `&model=${encodeURIComponent(modelId)}` : '';",
		);
	});
});
