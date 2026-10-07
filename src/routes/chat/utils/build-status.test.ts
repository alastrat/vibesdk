import { describe, expect, it } from 'vitest';
import type { BuildActivity } from '@/api-types';
import {
	applyBuildProgress,
	buildStatusFromConnect,
	describeBuildActivity,
	describeBuildActivityLabel,
	describeBuildHeadline,
	describeBuildLineCount,
	startBuildStatus,
} from './build-status';

const NOW = 2_000_000;
const THINKING: BuildActivity = { kind: 'thinking' };
const WRITING: BuildActivity = { kind: 'tool', toolName: 'write', path: 'src/App.tsx', lines: 12 };

describe('build status transitions', () => {
	it('starts a build at step 0, thinking, on the local clock', () => {
		expect(startBuildStatus(NOW)).toEqual({ startedAt: NOW, step: 0, activity: THINKING });
	});

	it('takes the step and activity from progress but keeps the start time', () => {
		const next = applyBuildProgress(startBuildStatus(NOW), { elapsedMs: 90_000, step: 3, activity: WRITING }, NOW + 5_000);
		expect(next).toEqual({ startedAt: NOW, step: 3, activity: WRITING });
	});

	it('derives the start time from elapsed time when no status exists', () => {
		expect(applyBuildProgress(null, { elapsedMs: 90_000, step: 3, activity: THINKING }, NOW)).toEqual({
			startedAt: NOW - 90_000,
			step: 3,
			activity: THINKING,
		});
	});

	it('restores a running build on connect', () => {
		expect(buildStatusFromConnect({ elapsedMs: 192_000, step: 4, activity: WRITING }, NOW)).toEqual({
			startedAt: NOW - 192_000,
			step: 4,
			activity: WRITING,
		});
	});

	it('clears the status on connect when no build is running', () => {
		expect(buildStatusFromConnect(undefined, NOW)).toBeNull();
	});
});

describe('build status wording', () => {
	it('hides the step until the first one starts', () => {
		expect(describeBuildHeadline(0, 3)).toBe('Building · 0:03');
		expect(describeBuildHeadline(4, 192)).toBe('Building · step 4 · 3:12');
		expect(describeBuildHeadline(14, 3725)).toBe('Building · step 14 · 1:02:05');
	});

	it('says thinking when no tool is running', () => {
		expect(describeBuildActivity(THINKING)).toBe('Thinking…');
	});

	it('names the file and its lines while writing', () => {
		expect(describeBuildActivity({ kind: 'tool', toolName: 'write', path: 'src/pages/Catalog.tsx', lines: 340 })).toBe(
			'Writing src/pages/Catalog.tsx · 340 lines',
		);
		expect(describeBuildActivity({ kind: 'tool', toolName: 'write', path: 'src/a.ts', lines: 1 })).toBe('Writing src/a.ts · 1 line');
		expect(describeBuildActivity({ kind: 'tool', toolName: 'write', path: 'src/a.ts', lines: 1204 })).toBe(
			'Writing src/a.ts · 1,204 lines',
		);
	});

	it('counts lines before the path is known', () => {
		expect(describeBuildActivity({ kind: 'tool', toolName: 'write', lines: 340 })).toBe('Writing file · 340 lines');
	});

	it('shows other tools without a count', () => {
		expect(describeBuildActivity({ kind: 'tool', toolName: 'edit', path: 'src/App.tsx' })).toBe('Editing src/App.tsx');
		expect(describeBuildActivity({ kind: 'tool', toolName: 'deploy_space' })).toBe('Deploying');
	});
});

describe('build status wording split for the live region', () => {
	it('labels the activity without the line count', () => {
		expect(describeBuildActivityLabel(THINKING)).toBe('Thinking…');
		expect(describeBuildActivityLabel({ kind: 'tool', toolName: 'write', path: 'src/a.ts', lines: 340 })).toBe('Writing src/a.ts');
		expect(describeBuildActivityLabel({ kind: 'tool', toolName: 'write', lines: 340 })).toBe('Writing file');
		expect(describeBuildActivityLabel({ kind: 'tool', toolName: 'edit', path: 'src/App.tsx' })).toBe('Editing src/App.tsx');
	});

	it('words the line count on its own', () => {
		expect(describeBuildLineCount({ kind: 'tool', toolName: 'write', path: 'src/a.ts', lines: 340 })).toBe('340 lines');
		expect(describeBuildLineCount({ kind: 'tool', toolName: 'write', path: 'src/a.ts', lines: 1 })).toBe('1 line');
		expect(describeBuildLineCount({ kind: 'tool', toolName: 'write', path: 'src/a.ts', lines: 1204 })).toBe('1,204 lines');
	});

	it('has no line count while thinking, for other tools, or before any line is written', () => {
		expect(describeBuildLineCount(THINKING)).toBeNull();
		expect(describeBuildLineCount({ kind: 'tool', toolName: 'edit', path: 'src/App.tsx' })).toBeNull();
		expect(describeBuildLineCount({ kind: 'tool', toolName: 'write', path: 'src/a.ts' })).toBeNull();
	});
});
