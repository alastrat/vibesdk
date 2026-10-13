import { describe, expect, it } from 'vitest';
import { queryPersistOptions } from './query-client';
import { queryKeys } from './query-keys';

const { shouldDehydrateQuery } = queryPersistOptions.dehydrateOptions;

describe('query persistence', () => {
	it('never persists product pages, which carry a signed preview URL and a per-viewer offer', () => {
		expect(
			shouldDehydrateQuery({ queryKey: queryKeys.apps.sitePage('app1', 'u1'), state: { status: 'success' } }),
		).toBe(false);
	});
});
