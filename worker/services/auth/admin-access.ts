/**
 * Who is a platform admin: anyone with the admin role, or the owner signing
 * in through Google or GitHub, which verify the email they report. Cloudflare
 * is excluded because its sign-in defaults the email to verified without the
 * provider asserting it. Email and password sign-up never grants admin,
 * because those addresses are not verified.
 */

export const PLATFORM_ADMIN_EMAILS: readonly string[] = ['alastrat@pluriza.com'];

export const EMAIL_VERIFYING_PROVIDERS: readonly string[] = ['google', 'github'];

export function isPlatformAdminEmail(email: string): boolean {
	return PLATFORM_ADMIN_EMAILS.includes(email.trim().toLowerCase());
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
