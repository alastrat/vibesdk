/**
 * After the build: uploads the browser bundle's source maps to PostHog when CI has its credentials, then deletes every
 * map, so none is ever served. Without credentials (local builds, CI checks) it only deletes them. A failed upload
 * warns and never blocks a deploy.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ASSETS_DIR = 'dist/client/assets';
/** The personal API key and project id variables the pinned @posthog/cli reads; the deploy workflow supplies them. */
export const CLI_TOKEN_VAR = 'POSTHOG_CLI_API_KEY';
export const CLI_PROJECT_VAR = 'POSTHOG_CLI_PROJECT_ID';

export function uploadCommands(env: Record<string, string | undefined>, assetsDir: string): string[][] {
	if (!env[CLI_TOKEN_VAR] || !env[CLI_PROJECT_VAR]) return [];
	return [
		['sourcemap', 'inject', '--directory', assetsDir, '--release-name', 'estori'],
		['sourcemap', 'upload', '--directory', assetsDir, '--release-name', 'estori'],
	];
}

/** The CLI downloads its binary at runtime, so it gets only what it needs and none of the deploy's other credentials. */
export function cliEnv(env: Record<string, string | undefined>): Record<string, string> {
	const kept: Record<string, string> = {};
	for (const name of ['PATH', 'HOME', 'TMPDIR', 'CI', CLI_TOKEN_VAR, CLI_PROJECT_VAR]) {
		const value = env[name];
		if (value !== undefined) kept[name] = value;
	}
	return kept;
}

/** Why a spawned CLI call failed: its exit status, or the error when the binary could not start (a failed download). */
export function failureReason(run: { status: number | null; signal?: string | null; error?: Error }): string {
	if (run.error) return run.error.message;
	if (run.status !== null) return `exit status ${run.status}`;
	return run.signal ? `signal ${run.signal}` : 'unknown failure';
}

export function isSourceMap(file: string): boolean {
	return file.endsWith('.map');
}

async function main(): Promise<void> {
	const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
	const clientDir = path.join(root, 'dist', 'client');
	// Loaded here, since the Workers test pool that tests this file has no child processes or file system.
	const { spawnSync } = await import('node:child_process');
	const { readdirSync, rmSync } = await import('node:fs');
	const cli = path.join(root, 'node_modules', '.bin', 'posthog-cli');
	for (const args of uploadCommands(process.env, path.join(root, ASSETS_DIR))) {
		const run = spawnSync(cli, args, { stdio: 'inherit', env: cliEnv(process.env) });
		if (run.status !== 0) {
			console.warn(`posthog-cli ${args.slice(0, 2).join(' ')} failed (${failureReason(run)}); deploying without uploaded source maps`);
			break;
		}
	}
	const maps = readdirSync(clientDir, { recursive: true, encoding: 'utf8' }).filter(isSourceMap);
	for (const map of maps) rmSync(path.join(clientDir, map));
	console.log(`Source maps: deleted ${maps.length} from dist/client`);
}

// process.argv can be undefined in the Workers test pool, so guard each access.
if (process.argv?.[1]?.endsWith('posthog-sourcemaps.ts')) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}
