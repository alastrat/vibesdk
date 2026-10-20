/** The billing flag: BILLING=on for everyone, or BILLING_USER_IDS for the accounts that get it first. */

export function isBillingOn(env: { BILLING?: string; BILLING_USER_IDS?: string }, userId: string | null): boolean {
	if (env.BILLING?.trim().toLowerCase() === 'on') return true;
	if (!userId || !env.BILLING_USER_IDS) return false;
	return env.BILLING_USER_IDS.split(',').some((listed) => listed.trim() === userId);
}
