import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/src/routes.tsx', '/src/routes/signup.tsx', '/src/**/*.tsx'], {
	query: '?raw',
	import: 'default',
	eager: true,
});

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('signup page', () => {
	it('is a public route', () => {
		const routes = source('/src/routes.tsx');
		expect(routes).toContain("import SignupPage from './routes/signup';");
		expect(routes).toMatch(/path: 'signup',\s*Component: SignupPage,/);
	});

	it('stays blank until the signup design lands, and sends people who are already signed in to the app', () => {
		const page = source('/src/routes/signup.tsx');
		expect(page).toContain('<PageMeta title="Sign up"');
		expect(page).toContain('<h1 id="signup-title" className="sr-only">');
		expect(page).toContain('if (isAuthenticated) return <Navigate to="/" replace />;');
	});

	it('is where every Start building free button leads', () => {
		const offenders = Object.entries(sources)
			.filter(([path]) => !path.endsWith('.test.tsx'))
			.filter(([, text]) => /to="\/#build"[^>]*>\s*Start building free/.test(text))
			.map(([path]) => path);
		expect(offenders).toEqual([]);
		for (const path of [
			'/src/components/pricing/PlanCards.tsx',
			'/src/components/pricing/Calculator.tsx',
			'/src/components/public-site/solution-page.tsx',
			'/src/routes/solutions/brands.tsx',
			'/src/routes/solutions/digital.tsx',
			'/src/routes/landing/Features.tsx',
			'/src/routes/landing/sections.tsx',
		]) {
			expect(source(path), path).toMatch(/to="\/signup"[^>]*>\s*Start building free/);
		}
		expect(source('/src/components/pricing/ComparePlans.tsx')).toContain("basic: { price: '$0', note: 'Free forever', action: { to: '/signup', label: 'Start building'");
	});
});
