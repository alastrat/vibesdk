import { base64url, sha256Hash } from '../../utils/cryptoUtils';

export const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
export const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export const RESET_LINK_INVALID_MESSAGE = 'This reset link is invalid or has expired.';
export const CONFIRM_LINK_INVALID_MESSAGE = 'This confirmation link is invalid or has expired.';
export const FORGOT_PASSWORD_MESSAGE =
	"If an account exists for that email, we've sent a link to reset your password. It expires in 30 minutes.";

const TOKEN_BYTES = 32;

/** The value emailed to the user. Only its hash is ever stored. */
export function createOneTimeToken(): string {
	return base64url(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)));
}

export async function hashOneTimeToken(token: string): Promise<string> {
	return sha256Hash(token);
}

export function isTokenUsable(row: { used: boolean | null; expiresAt: Date }, now: Date): boolean {
	return !row.used && row.expiresAt.getTime() > now.getTime();
}
