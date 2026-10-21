/** Describes a per-step credit change, for example "about 136 credits per step instead of about 16 (about 8.5x)". */
export function describeCreditChange(current: number, next: number): string {
	if (next === current) return `about ${next} credits per step`;
	const base = `about ${next} credits per step instead of about ${current}`;
	if (current <= 0) return base;
	if (next > current) return `${base} (about ${Math.round((next / current) * 10) / 10}x)`;
	return `${base} (about ${Math.round((1 - next / current) * 100)}% cheaper)`;
}
