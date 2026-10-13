/**
 * Who is a platform admin: anyone with the admin role, or the owner signing
 * in through a provider (Google, GitHub, Cloudflare) that verified their
 * email. Email and password sign-up never grants admin, because those
 * addresses are not verified.
 */

export const PLATFORM_ADMIN_EMAILS: readonly string[] = ['alastrat@pluriza.com'];

export function isPlatformAdminDecision(
	role: string | null,
	identities: Array<{ email: string | null; emailVerified: boolean | null }>,
): boolean {
	if (role === 'admin') return true;
	return identities.some(
		(identity) =>
			identity.emailVerified === true &&
			identity.email !== null &&
			PLATFORM_ADMIN_EMAILS.includes(identity.email.toLowerCase()),
	);
}
