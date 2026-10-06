/** Describes a per-step credit change, for example "8 credits per step instead of 3 (about 2.7x)". */
export function describeCreditChange(current: number, next: number): string {
	const base = `${next} credits per step instead of ${current}`;
	if (current <= 0 || next === current) return base;
	if (next > current) return `${base} (about ${Math.round((next / current) * 10) / 10}x)`;
	return `${base} (about ${Math.round((1 - next / current) * 100)}% cheaper)`;
}
