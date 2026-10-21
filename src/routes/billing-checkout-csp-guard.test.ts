import { describe, expect, it } from 'vitest';
import { STRIPE_JS_URL } from '../../shared/types/stripe';

// The Workers test pool loads .html as a text module; `?raw` is not resolvable there.
const indexHtml = Object.values(import.meta.glob<string>('/index.html', { import: 'default', eager: true }))[0] ?? '';

const sources = import.meta.glob<string>(['/src/lib/stripe/stripe-js.ts'], { query: '?raw', import: 'default', eager: true });

function directive(name: string): string[] {
	const policy = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(indexHtml)?.[1] ?? '';
	const found = policy
		.split(';')
		.map((part) => part.trim().split(/\s+/))
		.find((parts) => parts[0] === name);
	return found ? found.slice(1) : [];
}

describe('the spa content security policy', () => {
	it('the spa csp allows stripe.js scripts', () => {
		const scriptSrc = directive('script-src');
		expect(scriptSrc).toContain('https://js.stripe.com');
		expect(scriptSrc).toContain('https://*.js.stripe.com');
		expect(scriptSrc).toContain(new URL(STRIPE_JS_URL).origin);
	});

	it("keeps the app's own script sources", () => {
		const scriptSrc = directive('script-src');
		expect(scriptSrc).toContain("'self'");
		expect(scriptSrc).toContain('https://static.cloudflareinsights.com');
	});

	it("already lets stripe's frames and api calls through", () => {
		expect(directive('frame-src')).toContain('https://*');
		expect(directive('connect-src')).toContain('https:');
	});

	it('loads stripe.js from the shared url, not a copy of it', () => {
		const loader = Object.values(sources)[0] ?? '';
		expect(loader).toContain('STRIPE_JS_URL');
		expect(loader).not.toContain('js.stripe.com');
	});
});
