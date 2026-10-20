import { describe, expect, it } from 'vitest';
import { CLI_PROJECT_VAR, CLI_TOKEN_VAR, isSourceMap, uploadCommands } from './posthog-sourcemaps';

const packageJson = import.meta.glob<string>(['/package.json'], { query: '?raw', import: 'default', eager: true })['/package.json'] ?? '';

describe('source maps for PostHog', () => {
	it("uploads only with both of the CLI's credentials, injecting chunk ids before uploading", () => {
		expect(uploadCommands({}, 'dist/client/assets')).toEqual([]);
		expect(uploadCommands({ [CLI_TOKEN_VAR]: 'phx_1' }, 'dist/client/assets')).toEqual([]);
		expect(uploadCommands({ [CLI_TOKEN_VAR]: 'phx_1', [CLI_PROJECT_VAR]: '123' }, 'dist/client/assets')).toEqual([
			['sourcemap', 'inject', '--directory', 'dist/client/assets'],
			['sourcemap', 'upload', '--directory', 'dist/client/assets', '--release-name', 'estori'],
		]);
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
