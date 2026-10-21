import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	[
		'/src/lib/api-client.ts',
		'/src/routes/chat/utils/handle-websocket-message.ts',
		'/src/App.tsx',
		'/src/utils/usage-limit-checker.tsx',
		'/src/components/usage-limits-badge.tsx',
		'/src/components/credits-banner.tsx',
		'/src/components/layout/app-sidebar.tsx',
	],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('plan limits in the app', () => {
	it('opens one Upgrade dialog for every refusal, from the API and from the build socket', () => {
		const client = source('/src/lib/api-client.ts');
		expect(client).toContain('isPlanLimitRefusal(data?.error?.planLimit)');
		// Every non-OK answer throws from requestRaw, so it is the one place that announces a refusal.
		const requestRaw = client.slice(client.indexOf('private async requestRaw<T>('), client.indexOf('// Platform Status API Methods'));
		expect(requestRaw.match(/announcePlanLimit\(/g)?.length).toBeGreaterThanOrEqual(1);
		const socket = source('/src/routes/chat/utils/handle-websocket-message.ts');
		expect(socket).toContain('errorData.code === PLAN_LIMIT_ERROR_CODE');
		expect(socket).toContain('announcePlanLimit(errorData.planLimit)');
		expect(source('/src/App.tsx')).toContain('<UpgradeDialogHost />');
	});

	it('stops asking for a Cloudflare account while billing is on, and shows the credits left to everyone', () => {
		const checker = source('/src/utils/usage-limit-checker.tsx');
		expect(checker.match(/if \(limitsData\.billing\) return \{ canProceed: true \};/g)?.length).toBe(2);
		const badge = source('/src/components/usage-limits-badge.tsx');
		expect(badge).toContain('!data.cloudflareConnectEnabled && !data.billing');
		expect(source('/src/components/credits-banner.tsx')).toContain('limitsData.billing');
		expect(source('/src/components/layout/app-sidebar.tsx')).toContain('!usageLimits.billing');
	});
});
