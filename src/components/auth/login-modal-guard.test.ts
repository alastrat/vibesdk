import { describe, expect, it } from 'vitest';
import indexCss from '../../index.css?raw';

const sources = import.meta.glob<string>(['/src/components/auth/login-modal.tsx', '/src/components/public-site/StartBuildingButton.tsx'], {
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

	it('shows a photo filling the left column on wider screens, with the form on the right', () => {
		const modal = sources['/src/components/auth/login-modal.tsx'] ?? '';
		expect(modal).toContain("const AUTH_PANEL_IMAGE = '/marketing/auth-panel.webp';");
		expect(modal).toMatch(/<aside[^>]*className="[^"]*hidden[^"]*md:block/);
		expect(modal).toContain('absolute inset-0 size-full object-cover');
		expect(modal).toContain('<EstoriLogo');
		expect(modal).toContain('font-public');
	});

	it('leads with a dark Continue with Google button, above the other providers', () => {
		const modal = sources['/src/components/auth/login-modal.tsx'] ?? '';
		expect(modal).toContain('Continue with Google');
		expect(modal).toContain("const GOOGLE_BUTTON = 'flex h-12 w-full items-center justify-center gap-3 rounded-full bg-[#22252f]");
		expect(modal.indexOf('Continue with Google')).toBeLessThan(modal.indexOf('Continue with GitHub'));
	});

	it('speaks as Estori, with the blue action of the public site', () => {
		const modal = sources['/src/components/auth/login-modal.tsx'] ?? '';
		expect(modal).toContain('Create your free account');
		expect(modal).not.toContain('amazing applications');
		expect(modal).not.toContain('Authentication required for this action');
		expect(modal).not.toContain('OrangeButton');
		expect(modal).toContain("pillClass('blue'");
	});

	it('opens in sign-up from every Start building free button, and sends people already signed in to the builder', () => {
		const button = sources['/src/components/public-site/StartBuildingButton.tsx'] ?? '';
		expect(button).toContain("showAuthModal(undefined, undefined, undefined, { initialMode: 'register' })");
		expect(button).toContain('<PillLink to="/" variant={variant}');
	});

	it('stacks above page content that sets its own z-index, such as the landing composer', () => {
		expect(indexCss).toMatch(/(^|\n)\s*#root\s*\{[^}]*isolation:\s*isolate/);
	});
});
