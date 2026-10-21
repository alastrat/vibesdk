import type { OAuthProvider } from '@/api-types';
import { getLocale } from '@/lib/i18n';

/**
 * Where to send the browser to sign in with a provider. It carries the language the visitor picked, because the provider
 * sends them back to the server with only their browser's languages, and a new account starts in the picked one.
 */
export function oauthStartPath(provider: OAuthProvider, redirectUrl?: string): string {
	const params = new URLSearchParams();
	if (redirectUrl) params.set('redirect_url', redirectUrl);
	params.set('locale', getLocale());
	return `/api/auth/oauth/${provider}?${params}`;
}
