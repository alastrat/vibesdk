import { describe, expect, it } from 'vitest';

type Sources = Record<string, string>;

const workerSources = import.meta.glob<string>(
	['/worker/**/*.ts', '!/worker/**/*.test.ts'],
	{ query: '?raw', import: 'default', eager: true },
);

const frontendSources = import.meta.glob<string>(
	['/src/**/*.{ts,tsx}', '!/src/**/*.test.{ts,tsx}'],
	{ query: '?raw', import: 'default', eager: true },
);

/** Lines matching `pattern` in `sources`, formatted as `path:line: text`. */
function findMatches(
	sources: Sources,
	pattern: RegExp,
	allow: readonly string[] = [],
): string[] {
	return Object.entries(sources)
		.filter(([path]) => !allow.includes(path))
		.flatMap(([path, text]) =>
			text
				.split('\n')
				.flatMap((line, index) =>
					pattern.test(line) ? [`${path}:${index + 1}: ${line.trim()}`] : [],
				),
		);
}

function source(sources: Sources, path: string): string {
	const text = sources[path];
	if (text === undefined) {
		throw new Error(`Source not found: ${path}`);
	}
	return text;
}

describe('brand guard: harness', () => {
	it('loads worker and frontend sources', () => {
		expect(Object.keys(workerSources).length).toBeGreaterThan(50);
		expect(Object.keys(frontendSources).length).toBeGreaterThan(50);
	});
});

describe('brand guard: worker', () => {
	it('does not commit as the VibeSDK bot', () => {
		expect(findMatches(workerSources, /vibesdk-bot@cloudflare\.com/)).toEqual([]);
	});

	it('defaults git commits to the brand author', () => {
		expect(source(workerSources, '/worker/agents/git/git.ts')).toContain(
			'BRAND.gitAuthor',
		);
	});

	it('does not name VibeSDK in agent prompts', () => {
		expect(findMatches(workerSources, /VibeSDK-specific/)).toEqual([]);
	});
});
