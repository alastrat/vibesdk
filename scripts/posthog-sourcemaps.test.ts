import { describe, expect, it } from 'vitest';
import { CLI_PROJECT_VAR, CLI_TOKEN_VAR, cliEnv, failureReason, isSourceMap, uploadCommands } from './posthog-sourcemaps';

const packageJson = import.meta.glob<string>(['/package.json'], { query: '?raw', import: 'default', eager: true })['/package.json'] ?? '';

describe('source maps for PostHog', () => {
	it("uploads only with both of the CLI's credentials, injecting chunk ids before uploading", () => {
		expect(uploadCommands({}, 'dist/client/assets')).toEqual([]);
		expect(uploadCommands({ [CLI_TOKEN_VAR]: 'phx_1' }, 'dist/client/assets')).toEqual([]);
		expect(uploadCommands({ [CLI_TOKEN_VAR]: 'phx_1', [CLI_PROJECT_VAR]: '123' }, 'dist/client/assets')).toEqual([
			['sourcemap', 'inject', '--directory', 'dist/client/assets', '--release-name', 'estori'],
			['sourcemap', 'upload', '--directory', 'dist/client/assets', '--release-name', 'estori'],
		]);
	});

	it('gives the CLI only the variables it needs, never the deploy credentials', () => {
		const deployEnv = {
			PATH: '/usr/bin',
			HOME: '/home/runner',
			TMPDIR: '/tmp',
			CI: 'true',
			[CLI_TOKEN_VAR]: 'phx_1',
			[CLI_PROJECT_VAR]: '123',
			CLOUDFLARE_API_TOKEN: 'cf_token',
			JWT_SECRET: 'jwt',
			GOOGLE_AI_STUDIO_API_KEY: 'ai_key',
		};
		expect(cliEnv(deployEnv)).toEqual({
			PATH: '/usr/bin',
			HOME: '/home/runner',
			TMPDIR: '/tmp',
			CI: 'true',
			[CLI_TOKEN_VAR]: 'phx_1',
			[CLI_PROJECT_VAR]: '123',
		});
		expect(cliEnv({ PATH: '/usr/bin' })).toEqual({ PATH: '/usr/bin' });
	});

	it('names the exit status, or the spawn error when the binary could not start', () => {
		expect(failureReason({ status: 1 })).toBe('exit status 1');
		expect(failureReason({ status: null, error: new Error('spawn ENOENT') })).toBe('spawn ENOENT');
		expect(failureReason({ status: null, signal: 'SIGKILL' })).toBe('signal SIGKILL');
		expect(failureReason({ status: null })).toBe('unknown failure');
	});

	it('deletes maps and nothing else', () => {
		expect(isSourceMap('assets/index-abc.js.map')).toBe(true);
		expect(isSourceMap('assets/index-abc.js')).toBe(false);
		expect(isSourceMap('assets/sitemap.xml')).toBe(false);
	});

	it('runs after every build, so maps are never deployed', () => {
		expect(packageJson).toContain('"build": "bun run --cwd space build && vite build && bun scripts/posthog-sourcemaps.ts"');
	});
});
