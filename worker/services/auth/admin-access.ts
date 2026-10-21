import { msg } from '../../../shared/i18n/translate';
/**
 * Who is a platform admin: anyone with the admin role, or the owner signing
 * in through Google or GitHub, which verify the email they report. Cloudflare
 * is excluded because its sign-in defaults the email to verified without the
 * provider asserting it. Email and password sign-up never grants admin,
 * because those addresses are not verified. For the same reason, only Google
 * and GitHub may create or auto-link an account under an admin email.
 */

export const PLATFORM_ADMIN_EMAILS: readonly string[] = ['alastrat@pluriza.com'];

export const EMAIL_VERIFYING_PROVIDERS: readonly string[] = ['google', 'github'];

export const ADMIN_EMAIL_PROVIDER_MESSAGE = msg('Sign in with Google or GitHub to use this email');

export function isPlatformAdminEmail(email: string): boolean {
	return PLATFORM_ADMIN_EMAILS.includes(email.trim().toLowerCase());
}

/** Whether an OAuth sign-in through this provider may create or auto-link an account under this email. */
export function mayClaimEmailByOAuth(provider: string, email: string): boolean {
	return !isPlatformAdminEmail(email) || EMAIL_VERIFYING_PROVIDERS.includes(provider);
}

export function isPlatformAdminDecision(
	role: string | null,
	identities: Array<{ provider: string; email: string | null; emailVerified: boolean | null }>,
): boolean {
	if (role === 'admin') return true;
	return identities.some(
		(identity) =>
			EMAIL_VERIFYING_PROVIDERS.includes(identity.provider) &&
			identity.emailVerified === true &&
			identity.email !== null &&
			isPlatformAdminEmail(identity.email),
	);
}
