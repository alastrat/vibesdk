import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	['/src/components/auth/AuthModalProvider.tsx', '/src/contexts/auth-context.tsx'],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

function callbackBody(text: string, name: string): string {
	const start = text.indexOf(`const ${name} = useCallback(`);
	if (start === -1) throw new Error(`Callback not found: ${name}`);
	return text.slice(start, text.indexOf('\n  }, [', start));
}

describe('returning to the build after email sign-in or sign-up', () => {
	const provider = source('/src/components/auth/AuthModalProvider.tsx');
	const auth = source('/src/contexts/auth-context.tsx');

	it('stores where the visitor was headed when the sign-in window opens', () => {
		expect(callbackBody(provider, 'showAuthModal')).toContain('setIntendedUrl(intendedUrl)');
	});

	it('forgets it when the window is dismissed, but keeps it when the window closes on sign-in', () => {
		expect(callbackBody(provider, 'hideAuthModal')).toContain('clearIntendedUrl()');
		expect(callbackBody(provider, 'closeAuthModal')).not.toContain('clearIntendedUrl');
		const onSignedIn = provider.slice(provider.indexOf('if (isAuthenticated && isAuthModalOpen'));
		expect(onSignedIn.slice(0, onSignedIn.indexOf('}, ['))).toContain('closeAuthModal()');
		expect(provider).toContain('onClose={hideAuthModal}');
	});

	it('navigates there once, from the stored URL, after both email sign-in and sign-up', () => {
		const start = auth.indexOf('const navigateAfterAuth');
		const navigateAfterAuth = auth.slice(start, auth.indexOf('\n\t}, [', start));
		expect(navigateAfterAuth).toContain('getIntendedUrl()');
		expect(navigateAfterAuth.match(/navigate\(/g)).toHaveLength(1);
		// The page being left must not re-render signed in (the landing page would swap to the builder home).
		expect(navigateAfterAuth).toContain('{ flushSync: true }');
		expect(auth.match(/navigateAfterAuth\(\);/g)).toHaveLength(2);
	});

	it("keeps the chat page's confirmation for URLs restored after sign-in", () => {
		expect(provider).not.toContain('fromPrompt');
		expect(auth).not.toContain('fromPrompt');
	});
});
