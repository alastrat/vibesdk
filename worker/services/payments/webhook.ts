/** Stripe webhook signature verification (HMAC-SHA256 over "{t}.{body}") and event parsing. */

export interface StripeEvent {
	id: string;
	type: string;
	/** The connected account a Connect event came from; absent for the platform's own events. */
	account?: string;
	data: { object: unknown };
}

const DEFAULT_TOLERANCE_SECONDS = 300;

function toHex(buffer: ArrayBuffer): string {
	return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Compare two hex strings without exiting early on the first difference. */
function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let difference = 0;
	for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return difference === 0;
}

export async function verifyStripeSignature(
	payload: string,
	header: string | null,
	secret: string,
	nowSeconds: number,
	toleranceSeconds: number = DEFAULT_TOLERANCE_SECONDS,
): Promise<boolean> {
	if (!header) return false;
	let timestamp: number | null = null;
	const signatures: string[] = [];
	for (const part of header.split(',')) {
		const [key, value] = part.trim().split('=', 2);
		if (key === 't' && value) timestamp = Number(value);
		if (key === 'v1' && value) signatures.push(value);
	}
	if (timestamp === null || !Number.isFinite(timestamp) || signatures.length === 0) return false;
	if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return false;

	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const expected = toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${payload}`)));
	return signatures.some((signature) => timingSafeEqual(signature, expected));
}

export function parseStripeEvent(payload: string): StripeEvent | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(payload);
	} catch {
		return null;
	}
	if (typeof parsed !== 'object' || parsed === null) return null;
	const event = parsed as { id?: unknown; type?: unknown; account?: unknown; data?: { object?: unknown } };
	if (typeof event.id !== 'string' || typeof event.type !== 'string' || typeof event.data !== 'object' || event.data === null) {
		return null;
	}
	return { id: event.id, type: event.type, account: typeof event.account === 'string' ? event.account : undefined, data: { object: event.data.object } };
}
