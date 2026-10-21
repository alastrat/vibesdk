/** The billing flag: BILLING=on for everyone, or BILLING_USER_IDS for the accounts that get it first. */

type BillingFlagEnv = { BILLING?: string; BILLING_USER_IDS?: string };

/** Everyone, or the listed accounts only (none when the list is empty). */
export function billingAudience(env: BillingFlagEnv): 'everyone' | readonly string[] {
	if (env.BILLING?.trim().toLowerCase() === 'on') return 'everyone';
	return (env.BILLING_USER_IDS ?? '')
		.split(',')
		.map((listed) => listed.trim())
		.filter((listed) => listed.length > 0);
}

export function isBillingOn(env: BillingFlagEnv, userId: string | null): boolean {
	const audience = billingAudience(env);
	if (audience === 'everyone') return true;
	return userId !== null && audience.includes(userId);
}
