/**
 * Runs the Vitest suite as sequential shards. With isolated storage, the Workers pool starts one runtime for every test
 * file in a run before running any, so a single run of the whole suite needs memory for all of them at once and outgrew
 * CI's runner. Each shard is its own run, starting runtimes for its files only. Given files or flags, it runs once.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_SHARDS = 8;
/**
 * macOS has about 16,000 ports for local connections and holds each closed one for about 30 s, while each test file
 * loads its imports over local connections; smaller shards keep one run within those ports.
 */
const MACOS_SHARDS = 16;
/** The next shard on macOS starts once fewer closed connections than this are left, or after 90 s. */
const MACOS_TIME_WAIT_LIMIT = 800;
const MACOS_DRAIN_MAX_MS = 90_000;

/** `TEST_SHARDS` when it's a positive whole number, otherwise 8, or 16 on macOS. */
export function shardCount(value: string | undefined, platform: string): number {
	const parsed = Number(value);
	if (value && Number.isInteger(parsed) && parsed > 0) return parsed;
	return platform === 'darwin' ? MACOS_SHARDS : DEFAULT_SHARDS;
}

/** The Vitest runs to make, in order: one per shard for the whole suite, or one run as asked. */
export function testRuns(args: readonly string[], shards: number): string[][] {
	if (args.length > 0) return [['run', ...args]];
	return Array.from({ length: shards }, (_, index) => ['run', `--shard=${index + 1}/${shards}`]);
}

/** Closed connections the system still holds, from `netstat -an`. */
export function timeWaitCount(netstat: string): number {
	return netstat.split('\n').filter((line) => line.includes('TIME_WAIT')).length;
}

/** On macOS, waits for the last shard's closed connections to clear, so the next one has ports to connect on. */
async function waitForLocalPorts(): Promise<void> {
	if (process.platform !== 'darwin') return;
	const { spawnSync } = await import('node:child_process');
	const deadline = Date.now() + MACOS_DRAIN_MAX_MS;
	while (Date.now() < deadline && timeWaitCount(spawnSync('netstat', ['-an'], { encoding: 'utf8' }).stdout ?? '') >= MACOS_TIME_WAIT_LIMIT) {
		await new Promise((resolve) => setTimeout(resolve, 2_000));
	}
}

/**
 * Runs one Vitest run in its own process group and answers its exit code. The pool can leave runtimes running after
 * the run exits, still reconnecting to it; they're in the run's group, so the group is ended before the next run.
 */
async function runInOwnGroup(command: string, args: readonly string[], cwd: string): Promise<number> {
	// Loaded here, since the Workers test pool that tests this file has no child processes.
	const { spawn, spawnSync } = await import('node:child_process');
	const child = spawn(command, args, { cwd, stdio: 'inherit', detached: true });
	// Through `kill`, since Bun's process.kill takes no process group; an empty group answers an error, which is fine.
	const endGroup = () => {
		if (child.pid !== undefined) spawnSync('sh', ['-c', `kill -KILL -- -${child.pid} 2>/dev/null`]);
	};
	// The run has its own group, so an interrupt here must reach it too.
	const interrupt = () => {
		endGroup();
		process.exit(130);
	};
	process.once('SIGINT', interrupt);
	const code = await new Promise<number>((resolve) => child.on('close', (status) => resolve(status ?? 1)));
	process.off('SIGINT', interrupt);
	endGroup();
	return code;
}

async function main(): Promise<void> {
	const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
	const vitest = path.join(root, 'node_modules', '.bin', 'vitest');
	const runs = testRuns(process.argv.slice(2), shardCount(process.env.TEST_SHARDS, process.platform));
	const failed: string[] = [];
	for (const run of runs) {
		await waitForLocalPorts();
		console.log(`\n== vitest ${run.join(' ')}`);
		if ((await runInOwnGroup(vitest, run, root)) !== 0) failed.push(run.join(' '));
	}
	if (failed.length > 0) {
		console.error(`\nFailed: ${failed.map((run) => `vitest ${run}`).join(', ')}`);
		process.exit(1);
	}
}

// process.argv can be undefined in the Workers test pool, so guard each access.
if (process.argv?.[1]?.endsWith('test-shards.ts')) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}
