import type { D1Migration } from '@cloudflare/vitest-pool-workers/config';

declare module 'cloudflare:test' {
	interface ProvidedEnv {
		TEST_DB: D1Database;
		TEMPLATES_BUCKET: R2Bucket;
		TEST_MIGRATIONS: D1Migration[];
	}
}
