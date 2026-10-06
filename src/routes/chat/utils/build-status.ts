import type { BuildActivity, BuildProgress } from '@/api-types';
import { formatElapsedTime } from '../hooks/use-debug-session';
import { getToolActivityLabel } from './tool-display';

/** A running build as the chat shows it. `startedAt` is on this browser's clock. */
export type BuildStatus = { startedAt: number; step: number; activity: BuildActivity };

export function startBuildStatus(now: number): BuildStatus {
	return { startedAt: now, step: 0, activity: { kind: 'thinking' } };
}

/**
 * Takes the step and activity from a progress message. The start time is kept
 * once known, so network jitter cannot move the clock back.
 */
export function applyBuildProgress(prev: BuildStatus | null, progress: BuildProgress, now: number): BuildStatus {
	return {
		startedAt: prev?.startedAt ?? now - progress.elapsedMs,
		step: progress.step,
		activity: progress.activity,
	};
}

/** The status for a tab that just connected: the running build, or none. */
export function buildStatusFromConnect(progress: BuildProgress | undefined, now: number): BuildStatus | null {
	return progress ? applyBuildProgress(null, progress, now) : null;
}

/** First line of the bar, e.g. "Building · step 4 · 3:12". */
export function describeBuildHeadline(step: number, elapsedSeconds: number): string {
	const clock = formatElapsedTime(elapsedSeconds);
	return step > 0 ? `Building · step ${step} · ${clock}` : `Building · ${clock}`;
}

/** Second line of the bar, e.g. "Writing src/App.tsx · 340 lines". */
export function describeBuildActivity(activity: BuildActivity): string {
	if (activity.kind === 'thinking') return 'Thinking…';
	const label = getToolActivityLabel(activity.toolName, activity.path ? { path: activity.path } : undefined);
	if (!activity.lines) return label;
	return `${label} · ${activity.lines.toLocaleString()} ${activity.lines === 1 ? 'line' : 'lines'}`;
}
