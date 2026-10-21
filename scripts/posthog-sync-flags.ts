/**
 * Creates the registry's flags that a PostHog project lacks, every one at 0%: nothing rolled out, nothing paused.
 * Pausing means raising a pause flag to 100% in PostHog. Existing flags are never changed; edits happen in PostHog.
 * Run by the owner, once per new project or new flag, with their own personal API key:
 *   POSTHOG_PERSONAL_API_KEY=... POSTHOG_PROJECT_ID=... bun scripts/posthog-sync-flags.ts
 */

import { FEATURE_FLAGS, FLAG_KEYS, isFlagKey, type FlagKey } from '../shared/types/feature-flags';

const API_ORIGIN = 'https://us.posthog.com';

export interface NewPostHogFlag {
	key: FlagKey;
	/** PostHog shows a flag's name as its description. */
	name: string;
	active: boolean;
	filters: { groups: Array<{ properties: never[]; rollout_percentage: number }> };
}

export function flagsToCreate(existingKeys: ReadonlySet<string>): NewPostHogFlag[] {
	return FLAG_KEYS.filter((key) => !existingKeys.has(key)).map((key) => ({
		key,
		name: FEATURE_FLAGS[key].description,
		active: true,
		filters: { groups: [{ properties: [], rollout_percentage: 0 }] },
	}));
}

async function main(): Promise<void> {
	const apiKey = process.env.POSTHOG_PERSONAL_API_KEY;
	const projectId = process.env.POSTHOG_PROJECT_ID;
	if (!apiKey || !projectId) throw new Error('Set POSTHOG_PERSONAL_API_KEY and POSTHOG_PROJECT_ID');
	const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
	const flagsUrl = `${API_ORIGIN}/api/projects/${encodeURIComponent(projectId)}/feature_flags/`;
	const listed = await fetch(`${flagsUrl}?limit=200`, { headers });
	if (!listed.ok) throw new Error(`Listing flags failed: ${listed.status}`);
	const existing = new Set(((await listed.json()) as { results: Array<{ key: string }> }).results.map((flag) => flag.key));
	for (const flag of flagsToCreate(existing)) {
		const created = await fetch(flagsUrl, { method: 'POST', headers, body: JSON.stringify(flag) });
		if (!created.ok) throw new Error(`Creating ${flag.key} failed: ${created.status} ${await created.text()}`);
		console.log(`Created ${flag.key} at ${flag.filters.groups[0]?.rollout_percentage ?? 0}%`);
	}
	console.log(`Already in PostHog, left as they are: ${[...existing].filter(isFlagKey).join(', ') || 'none'}`);
}

// process.argv can be undefined in the Workers test pool, so guard each access.
if (process.argv?.[1]?.endsWith('posthog-sync-flags.ts')) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}
