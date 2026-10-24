export const ACCOUNT_SECTIONS = [
	'profile',
	'appearance',
	'connections',
	'security',
	'billing',
	'privacy',
] as const;
export type AccountSection = (typeof ACCOUNT_SECTIONS)[number];

const ANCHOR_SECTIONS: Record<string, AccountSection> = {
	account: 'profile',
	language: 'appearance',
	appearance: 'appearance',
	connections: 'connections',
	cloudflare: 'connections',
	'api-keys': 'security',
	security: 'security',
	billing: 'billing',
	analytics: 'privacy',
	privacy: 'privacy',
	'danger-zone': 'privacy',
};

/** Old bookmarked anchors and OAuth return links remain valid within the section layout. */
export function accountSection(search: string, hash: string): AccountSection {
	const anchor = ANCHOR_SECTIONS[hash.replace(/^#/, '')];
	if (anchor) return anchor;
	const params = new URLSearchParams(search);
	const requested = params.get('section');
	if (!requested && params.get('config_needed') === 'true') return 'connections';
	return (
		ACCOUNT_SECTIONS.find((section) => section === requested) ?? 'profile'
	);
}

export function accountSectionSearch(
	search: string,
	section: AccountSection,
): string {
	const next = new URLSearchParams(search);
	next.set('section', section);
	return `?${next.toString()}`;
}
