import { describe, expect, it } from 'vitest';
import indexCss from '../../index.css?raw';

const sources = import.meta.glob<string>(['/src/components/auth/login-modal.tsx'], {
	query: '?raw',
	import: 'default',
	eager: true,
});

describe('sign-in window', () => {
	it("doesn't ask people to accept Cloudflare's terms and privacy policy", () => {
		const modal = sources['/src/components/auth/login-modal.tsx'];
		expect(modal).toBeDefined();
		expect(modal).not.toContain('cloudflare.com/website-terms');
		expect(modal).not.toContain('cloudflare.com/privacypolicy');
		expect(modal).not.toContain('By continuing, you agree to our');
	});

	it('stacks above page content that sets its own z-index, such as the landing composer', () => {
		expect(indexCss).toMatch(/(^|\n)\s*#root\s*\{[^}]*isolation:\s*isolate/);
	});
});
