import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';
import { fileURLToPath } from 'node:url';

const runIntegrationTests = process.env.VIBESDK_RUN_INTEGRATION_TESTS === '1';

export default defineWorkersConfig(async () => {
  // Tests that run real SQL apply these to TEST_DB (worker/database/test-support/real-d1.ts).
  const migrations = await readD1Migrations(fileURLToPath(new URL('./migrations', import.meta.url)));
  return {
  resolve: {
    alias: {
      'bun:test': 'vitest',
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    // Brand tests read these stylesheets as raw text; Vitest returns an empty
    // string for CSS unless it is opted in here.
    css: { include: [/estori-theme\.css/, /src\/index\.css/, /public-site\.css/, /magicui\.css/] },
    pool: '@cloudflare/vitest-pool-workers',
    deps: {
      optimizer: {
        ssr: {
          enabled: true,
          include: [
            '@cloudflare/containers',
            '@cloudflare/sandbox',
            '@babel/traverse',
            '@babel/types',
            // Bundle visx's vendored D3 ESM exports for the Workers test runtime.
            '@visx/curve',
            '@visx/scale',
            '@visx/shape',
            '@visx/responsive',
          ],
        },
      },
    },
    poolOptions: {
      workers: {
        main: './test/worker-entry.ts',
        wrangler: { configPath: './wrangler.test.jsonc' },
        miniflare: {
          compatibilityDate: '2024-12-12',
          compatibilityFlags: ['nodejs_compat'],
          bindings: { TEST_MIGRATIONS: migrations },
        },
      },
    },
    include: ['**/*.{test,spec}.{js,ts,jsx,tsx}'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.git/**',
      '**/worker/api/routes/**',
      '**/test/worker-entry.ts',
      '**/container/monitor-cli.test.ts',
      '**/cf-git/**',
      '**/sdk/test/**', // SDK tests run with bun test, not vitest
      '**/scripts/seed-local-store-transactions.test.ts', // Local SQLite seeder uses bun:sqlite; run with bun test
      ...(runIntegrationTests ? [] : ['**/sdk/test/integration/**']),
    ],
  },
};
});
