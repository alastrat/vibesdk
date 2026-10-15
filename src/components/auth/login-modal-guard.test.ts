import { describe, expect, it } from 'vitest';
import indexCss from '../../index.css?raw';

const sources = import.meta.glob<string>(
	[
		'/src/components/auth/login-modal.tsx',
		'/src/components/auth/AuthForm.tsx',
		'/src/components/auth/AuthPhoto.tsx',
		'/src/components/auth/AuthModalProvider.tsx',
		'/src/components/auth/AuthPageLayout.tsx',
		'/src/components/public-site/StartBuildingButton.tsx',
	],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

const MODAL = '/src/components/auth/login-modal.tsx';
const FORM = '/src/components/auth/AuthForm.tsx';
const PHOTO = '/src/components/auth/AuthPhoto.tsx';

describe('signing in and up', () => {
	it("doesn't ask people to accept Cloudflare's terms and privacy policy", () => {
		for (const path of [MODAL, FORM]) {
			expect(source(path)).not.toContain('cloudflare.com/website-terms');
			expect(source(path)).not.toContain('cloudflare.com/privacypolicy');
			expect(source(path)).not.toContain('By continuing, you agree to our');
		}
	});

	it('shows a photo per view, with a caption over a dark fade', () => {
		const photo = source(PHOTO);
		expect(photo).toContain('const PHOTOS: Readonly<Record<PhotoView, Photo>> = {');
		expect(photo).toContain("image: '/marketing/auth-signup.webp'");
		expect(photo).toContain("image: '/marketing/auth-signin.webp'");
		expect(photo).toContain('absolute inset-0 size-full object-cover');
	});

	it('leads with a dark Continue with Google button, above the other providers', () => {
		const form = source(FORM);
		expect(form).toContain('Continue with Google');
		expect(form).toContain("const GOOGLE_BUTTON = 'flex h-12 w-full items-center justify-center gap-3 rounded-full bg-[#22252f]");
		expect(form.indexOf('Continue with Google')).toBeLessThan(form.indexOf('Continue with GitHub'));
	});

	it('speaks as Estori, with the blue action of the public site', () => {
		const form = source(FORM);
		expect(form).toContain('Create your free account');
		expect(form).toContain('Sign in to keep building your internet empire.');
		expect(form).not.toContain('amazing applications');
		expect(form).not.toContain('Authentication required for this action');
		expect(form).not.toContain('OrangeButton');
		expect(form).toContain("pillClass('blue'");
	});

	it('keeps the window for signing in only, beside the sign-in photo, with no logo', () => {
		const modal = source(MODAL);
		expect(modal).toContain('<AuthPhoto view="login"');
		expect(modal).toMatch(/<AuthPhoto[^>]*className="[^"]*hidden[^"]*md:block/);
		expect(modal).not.toContain('<EstoriLogo');
		expect(modal).toContain('font-public');
		expect(modal).toContain('initialMode?: SignInView;');
		expect(source(FORM)).toContain("export type SignInView = 'login' | 'forgot';");
	});

	it('sends "Create an account" from the window to the sign-up page, keeping where the visitor was headed', () => {
		const provider = source('/src/components/auth/AuthModalProvider.tsx');
		expect(provider).toContain('const goToSignup = useCallback(() => {');
		expect(provider).toMatch(/const goToSignup = useCallback\(\(\) => \{\s*closeAuthModal\(\);\s*navigate\('\/signup'\);/);
		expect(source(MODAL)).toContain('onCreateAccount={onCreateAccount}');
	});

	it('dims the page behind the window more than other dialogs', () => {
		expect(source(MODAL)).toContain('auth-dialog');
		// Kumo's styled backdrop, not Base UI's bare one; focus guards sit between it and the window.
		expect(indexCss).toMatch(/\[role='presentation'\]\[class\]:has\(~ \.auth-dialog\)\s*\{\s*background-color: rgb\(0 0 0 \/ 0\.6\);/);
	});

	it('sends Start building free to the sign-up page, and people already signed in to the builder', () => {
		expect(source('/src/components/public-site/StartBuildingButton.tsx')).toContain("<PillLink to={isAuthenticated ? '/' : '/signup'}");
	});

	it('lays the sign-up and sign-in pages out as a full-height photo beside the form, with the logo linking home', () => {
		const layout = source('/src/components/auth/AuthPageLayout.tsx');
		expect(layout).toContain('<AuthPhoto view={view}');
		expect(layout).toContain('<Link to="/" aria-label="Estori home"');
		expect(layout).toContain('<h1');
	});

	it('stacks above page content that sets its own z-index, such as the landing composer', () => {
		expect(indexCss).toMatch(/(^|\n)\s*#root\s*\{[^}]*isolation:\s*isolate/);
	});
});
