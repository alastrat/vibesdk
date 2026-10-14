import { base64url, sha256Hash } from '../../utils/cryptoUtils';

export const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
export const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

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
