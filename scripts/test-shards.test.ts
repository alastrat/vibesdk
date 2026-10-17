import { describe, expect, it } from 'vitest';
import { shardCount, testRuns, timeWaitCount } from './test-shards';
import packageSource from '../package.json?raw';

describe('running the test suite in shards', () => {
	it('runs the whole suite as sequential shards, so each run starts runtimes for its own files only', () => {
		expect(testRuns([], 3)).toEqual([
			['run', '--shard=1/3'],
			['run', '--shard=2/3'],
			['run', '--shard=3/3'],
		]);
	});

	it('runs once, as asked, when given files or flags', () => {
		expect(testRuns(['worker/services/live-stores'], 8)).toEqual([['run', 'worker/services/live-stores']]);
		expect(testRuns(['--reporter=verbose'], 8)).toEqual([['run', '--reporter=verbose']]);
	});

	it('uses 8 shards, or 16 on macOS where each run must fit in fewer local ports, unless TEST_SHARDS names another positive whole number', () => {
		expect(shardCount(undefined, 'linux')).toBe(8);
		expect(shardCount(undefined, 'darwin')).toBe(16);
		expect(shardCount('12', 'linux')).toBe(12);
		expect(shardCount('12', 'darwin')).toBe(12);
		for (const value of ['0', '-2', '2.5', 'many', '']) expect(shardCount(value, 'linux'), value).toBe(8);
	});

	it("counts the closed local connections macOS still holds, so the next shard waits until there are ports", () => {
		const netstat = [
			'Active Internet connections (including servers)',
			'tcp4       0      0  127.0.0.1.52011        127.0.0.1.8100         TIME_WAIT',
			'tcp4       0      0  127.0.0.1.52012        127.0.0.1.8100         ESTABLISHED',
			'tcp4       0      0  127.0.0.1.52013        127.0.0.1.61234        TIME_WAIT',
		].join('\n');
		expect(timeWaitCount(netstat)).toBe(2);
		expect(timeWaitCount('')).toBe(0);
	});

	it('is what `bun run test` runs, in CI and in the deploy gate', () => {
		expect(JSON.parse(packageSource).scripts.test).toBe('bun scripts/test-shards.ts');
	});
});
