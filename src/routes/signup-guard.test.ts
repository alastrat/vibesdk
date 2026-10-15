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
	it('starts from the sign-up page on every Start building free button', () => {
		const linked = Object.entries(sources)
			.filter(([path]) => !path.endsWith('.test.tsx') && !path.endsWith('StartBuildingButton.tsx'))
			.filter(([, text]) => /<(PillLink|Link)[^>]*>\s*Start building free/.test(text))
			.map(([path]) => path);
		expect(linked).toEqual([]);
		for (const path of [
			'/src/components/layout/PublicTopBar.tsx',
			'/src/components/pricing/PlanCards.tsx',
			'/src/components/pricing/Calculator.tsx',
			'/src/components/public-site/solution-page.tsx',
			'/src/routes/landing/Features.tsx',
			'/src/routes/landing/sections.tsx',
		]) {
			expect(source(path), path).toContain('<StartBuildingButton');
		}
	});

	it('has its own pages for signing up and signing in, outside the site header and footer', () => {
		const routes = source('/src/routes.tsx');
		expect(routes).toContain("import SignupPage from './routes/auth/SignupPage';");
		expect(routes).toContain("import LoginPage from './routes/auth/LoginPage';");
		const publicShell = routes.slice(routes.indexOf('Component: PublicShell'));
		expect(publicShell).not.toContain("path: 'signup'");
		expect(routes).toMatch(/path: 'signup',\s*Component: SignupPage,/);
		expect(routes).toMatch(/path: 'login',\s*Component: LoginPage,/);
	});

	it('signs up on the page and signs in on the page, each linking to the other', () => {
		const signup = source('/src/routes/auth/SignupPage.tsx');
		expect(signup).toContain('<AuthForm');
		expect(signup).toContain('mode="register"');
		expect(signup).toContain("onSignIn={() => navigate('/login')}");
		expect(signup).toContain('if (isAuthenticated) return <Navigate to="/" replace />;');
		const login = source('/src/routes/auth/LoginPage.tsx');
		expect(login).toContain('<AuthForm');
		expect(login).toContain("onCreateAccount={() => navigate('/signup')}");
		expect(login).toContain('if (isAuthenticated) return <Navigate to="/" replace />;');
	});
});
