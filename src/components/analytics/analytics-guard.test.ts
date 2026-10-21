import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	[
		'/src/components/analytics/PostHogSync.tsx',
		'/src/lib/analytics/posthog-browser.ts',
		'/src/App.tsx',
		'/src/components/ErrorBoundary.tsx',
		'/src/contexts/auth-context.tsx',
		'/src/hooks/use-flag.ts',
	],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('PostHog in the browser', () => {
	const sync = source('/src/components/analytics/PostHogSync.tsx');

	it("loads only with this host's token, so staging, previews and stores never load it", () => {
		expect(sync).toContain('posthogTokenFor(window.location.hostname, config.data?.localProjectKey ?? null)');
		expect(sync).toContain('if (loaded.current || !token || !environment || !ready) return;');
	});

	it('identifies people by user id only, never by email, name or username', () => {
		const person = source('/src/lib/analytics/posthog-browser.ts');
		expect(sync).toContain('const userId = user?.id ?? null;');
		expect(sync).toContain('syncPerson(posthog, syncedUserId.current, userId, optedOut);');
		expect(person).toContain('client.identify(userId)');
		for (const text of [sync, person]) expect(text).not.toMatch(/email|displayName|username/);
	});

	it('keeps PostHog in step before the page paints, so a paused page is never recorded', () => {
		expect(sync).not.toMatch(/\buseEffect\b/);
		expect(sync.match(/useLayoutEffect\(\(\) => \{/g)?.length).toBe(3);
	});

	it('pauses replay on the paused paths and when the pause flag is on, and resumes it under the sampling rules', () => {
		expect(sync).toContain("telemetry?.flags['session-replay-paused']");
		expect(sync).toContain('config.data?.replayPaused');
		expect(sync).toContain('replayPausedOn(pathname)');
		expect(sync).toContain('posthog.stopSessionRecording()');
		expect(sync).toContain('posthog.startSessionRecording()');
	});

	it('is mounted once, inside the auth provider', () => {
		const app = source('/src/App.tsx');
		const mounted = app.indexOf('<PostHogSync />');
		expect(mounted).toBeGreaterThan(app.indexOf('<AuthProvider>'));
		expect(mounted).toBeLessThan(app.indexOf('</AuthProvider>'));
	});

	it('reports what the error boundary catches', () => {
		expect(source('/src/components/ErrorBoundary.tsx')).toContain('captureBrowserException(');
	});

	it('keeps the session telemetry from the profile and sign-in answers, and reads a flag as off without it', () => {
		const auth = source('/src/contexts/auth-context.tsx');
		expect(auth.match(/telemetry: data\.telemetry \?\? null/g)?.length).toBe(2);
		expect(source('/src/hooks/use-flag.ts')).toContain('return telemetry?.flags[key] ?? false;');
	});
});
