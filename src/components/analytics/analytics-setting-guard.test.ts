import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/src/components/analytics/AnalyticsPreferenceCard.tsx', '/src/routes/settings/index.tsx', '/src/hooks/use-telemetry.ts'], {
	query: '?raw',
	import: 'default',
	eager: true,
});

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('the analytics setting', () => {
	const card = source('/src/components/analytics/AnalyticsPreferenceCard.tsx');

	it('is a card in Settings', () => {
		expect(source('/src/routes/settings/index.tsx')).toContain('<AnalyticsPreferenceCard />');
	});

	it('says what is shared and that the email and name never are', () => {
		expect(card).toContain('Share usage analytics with');
		expect(card).toContain("recordings of some sessions that show layouts and clicks but not");
		expect(card).toContain('Your email and name are never shared.');
	});

	it("can't turn analytics on while the browser sends GPC, and says why", () => {
		expect(card).toContain('GPC_ANALYTICS_MESSAGE');
		expect(card).toContain('disabled={!data || data.gpc || update.isPending}');
	});

	it('applies the choice in this browser and refreshes the session', () => {
		const hooks = source('/src/hooks/use-telemetry.ts');
		expect(hooks).toContain('applyAnalyticsChoice(data.optedOut)');
		expect(hooks).toContain('await refreshUser()');
	});
});
