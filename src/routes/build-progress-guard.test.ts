import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	[
		'/src/components/BuildProgressBar.tsx',
		'/src/hooks/use-elapsed-seconds.ts',
		'/src/routes/chat/chat.tsx',
		'/src/routes/chat/hooks/use-chat.ts',
		'/src/routes/chat/utils/handle-websocket-message.ts',
	],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

function between(text: string, start: string, end: string): string {
	const from = text.indexOf(start);
	if (from === -1) throw new Error(`Marker not found: ${start}`);
	const to = text.indexOf(end, from + start.length);
	if (to === -1) throw new Error(`Marker not found: ${end}`);
	return text.slice(from, to);
}

const HANDLER = '/src/routes/chat/utils/handle-websocket-message.ts';
const HOOK = '/src/routes/chat/hooks/use-chat.ts';

describe('build progress: chat state', () => {
	it('starts a fresh status whenever a think build starts', () => {
		const started = between(source(HANDLER), "case 'generation_started':", "case 'generation_complete':");
		expect(started).toContain("if (behaviorType === 'think') setBuildStatus(startBuildStatus(Date.now()));");
	});

	it('clears the status when the build ends', () => {
		const complete = between(source(HANDLER), "case 'generation_complete':", "case 'build_progress':");
		expect(complete).toContain('setBuildStatus(null);');
	});

	it('applies progress messages', () => {
		const progress = between(source(HANDLER), "case 'build_progress':", 'break;');
		expect(progress).toContain('setBuildStatus((prev) => applyBuildProgress(prev, message.progress, Date.now()));');
	});

	it('restores or clears the status on every connect, not only the first', () => {
		const connected = between(source(HANDLER), "case 'agent_connected':", 'if (!isInitialStateRestored)');
		expect(connected).toContain('setBuildStatus(buildStatusFromConnect(message.buildProgress, Date.now()));');
	});

	it('does not log every progress message', () => {
		expect(source(HANDLER)).toContain("message.type !== 'build_progress'");
	});

	it('holds the status in the chat hook and returns it', () => {
		const hook = source(HOOK);
		expect(hook).toContain('const [buildStatus, setBuildStatus] = useState<BuildStatus | null>(null);');
		expect(between(hook, 'createWebSocketMessageHandler({', '} as HandleMessageDeps)')).toContain('setBuildStatus,');
		expect(hook.slice(hook.lastIndexOf('return {'))).toContain('buildStatus,');
	});
});

const BAR = '/src/components/BuildProgressBar.tsx';
const CHAT = '/src/routes/chat/chat.tsx';

describe('build progress: bar', () => {
	it('renders nothing without a running build', () => {
		expect(source(BAR)).toContain('if (!status) return null;');
	});

	it('ticks the clock inside the bar only', () => {
		expect(source(BAR)).toContain('useElapsedSeconds(status?.startedAt ?? null)');
		expect(source(CHAT)).not.toContain('useElapsedSeconds');
	});

	it('computes elapsed time from the start time, so background tabs stay correct', () => {
		const hook = source('/src/hooks/use-elapsed-seconds.ts');
		expect(hook).toContain('Math.max(0, Math.floor((now - startedAt) / 1000))');
		expect(hook).toContain('}, [startedAt]);');
	});

	it('announces the activity but not the clock', () => {
		const bar = source(BAR);
		expect(bar.match(/role="status"/g) ?? []).toHaveLength(1);
		const live = bar.slice(bar.indexOf('role="status"'));
		expect(live).toContain('describeBuildActivityLabel(status.activity)');
		expect(live).not.toContain('describeBuildLineCount');
		expect(live).not.toContain('describeBuildHeadline');
	});

	it('shows the bar above the chat input, before the failure card', () => {
		const above = source(CHAT).slice(source(CHAT).indexOf('aboveContent={'));
		expect(above).toContain('<BuildProgressBar status={buildStatus} />');
		expect(above.indexOf('<BuildProgressBar')).toBeLessThan(above.indexOf('<ModelUnavailableNotice'));
	});
});
