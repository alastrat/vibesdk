import { describe, expect, it } from 'vitest';
import { DatabaseService } from './database';

/** A D1 binding as the services see it: only prepare matters here. */
function binding(): D1Database {
	return { prepare: () => ({}), batch: async () => [], exec: async () => ({}), dump: async () => new ArrayBuffer(0), withSession: () => ({}) } as unknown as D1Database;
}

describe('the D1 binding and Sentry', () => {
	it('is instrumented once, however many services are built on it, so queries never stack one proxy per service', () => {
		const env = { DB: binding() } as unknown as Env;
		new DatabaseService(env);
		const wrapped = env.DB.prepare;
		for (let built = 0; built < 5; built++) new DatabaseService(env);
		expect(env.DB.prepare).toBe(wrapped);
	});
});
