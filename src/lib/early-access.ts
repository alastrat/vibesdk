import { isEarlyAccessCapability, type EarlyAccessCapability } from '@/api-types';

/** The query parameter that carries a request through a sign-in that reloads the page (Google, GitHub). */
export const EARLY_ACCESS_PARAM = 'request';

export function earlyAccessReturnUrl(pathname: string, capability: EarlyAccessCapability): string {
	return `${pathname}?${EARLY_ACCESS_PARAM}=${capability}`;
}

/** The program named in the query, or null when there's none or it doesn't take requests. */
export function requestedCapability(search: string): EarlyAccessCapability | null {
	const value = new URLSearchParams(search).get(EARLY_ACCESS_PARAM);
	return isEarlyAccessCapability(value) ? value : null;
}
