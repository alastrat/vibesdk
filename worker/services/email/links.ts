import { isLocalHost } from '../../utils/urls';
import { RESET_PASSWORD_PATH, VERIFY_EMAIL_PATH } from '../../../shared/types/account-email';
import { ADMIN_CATALOG_ORDERS_PATH } from '../../../shared/types/catalog';

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

/** The deployment's own address, for links made without a request: https, or http on this machine; null without a domain. */
export function configuredBaseUrl(env: Env): string | null {
	const customDomain = env.CUSTOM_DOMAIN?.trim();
	if (!customDomain) return null;
	return `${isLocalHost(customDomain) ? 'http' : 'https'}://${customDomain}`;
}

export function adminCatalogOrderLink(base: string, orderId: string): string {
	return `${base}${ADMIN_CATALOG_ORDERS_PATH}/${encodeURIComponent(orderId)}`;
}

export function resetPasswordLink(base: string, token: string): string {
	return `${base}${RESET_PASSWORD_PATH}?token=${encodeURIComponent(token)}`;
}

export function verifyEmailLink(base: string, token: string): string {
	return `${base}${VERIFY_EMAIL_PATH}?token=${encodeURIComponent(token)}`;
}
