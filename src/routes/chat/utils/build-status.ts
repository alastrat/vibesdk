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

/** The activity without its line count, e.g. "Writing src/App.tsx". Safe to announce. */
export function describeBuildActivityLabel(activity: BuildActivity): string {
	if (activity.kind === 'thinking') return 'Thinking…';
	if (activity.kind === 'capturing') return `Capturing ${activity.host} · ${activity.index} of ${activity.total}`;
	return getToolActivityLabel(activity.toolName, activity.path ? { path: activity.path } : undefined);
}

/** The line count of a write in progress, e.g. "340 lines", or null when there is none. */
export function describeBuildLineCount(activity: BuildActivity): string | null {
	if (activity.kind !== 'tool' || !activity.lines) return null;
	return `${activity.lines.toLocaleString()} ${activity.lines === 1 ? 'line' : 'lines'}`;
}

/** Second line of the bar as one string, e.g. "Writing src/App.tsx · 340 lines". */
export function describeBuildActivity(activity: BuildActivity): string {
	const label = describeBuildActivityLabel(activity);
	const lineCount = describeBuildLineCount(activity);
	return lineCount ? `${label} · ${lineCount}` : label;
}
