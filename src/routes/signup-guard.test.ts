import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/src/routes.tsx', '/src/**/*.tsx'], {
	query: '?raw',
	import: 'default',
	eager: true,
});

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('signing up', () => {
	it('starts from the sign-up window on every Start building free button', () => {
		const linked = Object.entries(sources)
			.filter(([path]) => !path.endsWith('.test.tsx'))
			.filter(([, text]) => /<(PillLink|Link)[^>]*>\s*Start building free/.test(text))
			.map(([path]) => path);
		expect(linked).toEqual([]);
		for (const path of [
			'/src/components/layout/PublicTopBar.tsx',
			'/src/components/pricing/PlanCards.tsx',
			'/src/components/pricing/Calculator.tsx',
			'/src/components/public-site/solution-page.tsx',
			'/src/routes/solutions/brands.tsx',
			'/src/routes/solutions/digital.tsx',
			'/src/routes/landing/Features.tsx',
			'/src/routes/landing/sections.tsx',
			'/src/routes/creators/content.tsx',
			'/src/routes/creators/developers.tsx',
		]) {
			expect(source(path), path).toContain('<StartBuildingButton');
		}
		expect(source('/src/components/pricing/ComparePlans.tsx')).toContain('<StartBuildingButton variant="blue"');
	});

	it('keeps /signup as a link that opens the sign-up window over the home page', () => {
		expect(source('/src/routes.tsx')).toMatch(/path: 'signup',\s*Component: SignupPage,/);
		const page = source('/src/routes/signup.tsx');
		expect(page).toContain("showAuthModal(undefined, undefined, undefined, { initialMode: 'register' })");
		expect(page).toContain("navigate('/', { replace: true })");
	});
});
