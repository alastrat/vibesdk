import { isLocalHost } from '../../utils/urls';

/**
 * Production links use the configured domain, never the request's Host header,
 * so a forged Host cannot plant a link to another site in an email.
 */
export function appBaseUrl(env: Env, request: Request): string {
	const url = new URL(request.url);
	const customDomain = env.CUSTOM_DOMAIN?.trim();
	if (customDomain && !isLocalHost(url.host)) {
		return `https://${customDomain}`;
	}
	return url.origin;
}

export function resetPasswordLink(base: string, token: string): string {
	return `${base}/reset-password?token=${encodeURIComponent(token)}`;
}

export function verifyEmailLink(base: string, token: string): string {
	return `${base}/verify-email?token=${encodeURIComponent(token)}`;
}
