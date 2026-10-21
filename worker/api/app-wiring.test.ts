import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/worker/app.ts'], { query: '?raw', import: 'default', eager: true });

describe('the Hono app', () => {
	it('reports errors no route handled', () => {
		expect(sources['/worker/app.ts']).toContain('app.onError(unhandledApiError);');
	});
});
