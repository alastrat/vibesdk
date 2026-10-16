/** CJ's US dollars (a number or a decimal string) as whole cents, without floating-point multiplication. Null when unreadable. */
export function usdToCents(value: string | number): number | null {
	const text = typeof value === 'number' ? (Number.isFinite(value) ? String(value) : '') : value.trim();
	const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
	if (!match) return null;
	const fraction = (match[2] ?? '').padEnd(3, '0');
	const cents = Number(match[1]) * 100 + Number(fraction.slice(0, 2));
	return Number(fraction[2]) >= 5 ? cents + 1 : cents;
}
