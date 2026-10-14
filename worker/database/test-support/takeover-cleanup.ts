import { expect } from 'vitest';
import { assignedValues, writes, type Statement } from './recorded-statements';

/** Tables whose rows for the account are deleted when its unconfirmed address passes to the proven owner. */
const DELETED_TABLES = [
	'user_oauth_identities',
	'stripe_connect_accounts',
	'user_model_providers',
	'user_model_configs',
	'ai_gateways',
	'cloudflare_accounts',
] as const;

/** Updates that sign every session of an account out. */
export function sessionRevokes(statements: Statement[]): Statement[] {
	return writes(statements, 'update', 'sessions').filter((entry) => entry.params.includes('user_force_logout'));
}

/** Every write that strips an account of what someone other than its owner could have attached. */
export function takeoverCleanupWrites(statements: Statement[]): Statement[] {
	return [
		...DELETED_TABLES.flatMap((table) => writes(statements, 'delete', table)),
		...writes(statements, 'update', 'api_keys'),
		...sessionRevokes(statements),
	];
}

/** Asserts the full cleanup for `userId` ran inside `batch`, children before parents. */
export function expectTakeoverCleanupIn(batch: Statement[], statements: Statement[], userId: string): void {
	for (const table of DELETED_TABLES) {
		const deletes = writes(statements, 'delete', table);
		expect(deletes, `delete from ${table}`).toHaveLength(1);
		expect(deletes[0].params, `delete from ${table}`).toEqual([userId]);
		expect(batch, `delete from ${table} in the batch`).toContain(deletes[0]);
	}

	const keys = writes(statements, 'update', 'api_keys');
	expect(keys).toHaveLength(1);
	expect(assignedValues(keys[0]).is_active).toBe(0);
	expect(keys[0].params.at(-1)).toBe(userId);
	expect(batch).toContain(keys[0]);

	const revokes = sessionRevokes(statements);
	expect(revokes).toHaveLength(1);
	expect(assignedValues(revokes[0]).is_revoked).toBe(1);
	expect(revokes[0].params.at(-1)).toBe(userId);
	expect(batch).toContain(revokes[0]);

	const gateways = writes(statements, 'delete', 'ai_gateways')[0];
	const accounts = writes(statements, 'delete', 'cloudflare_accounts')[0];
	expect(batch.indexOf(gateways)).toBeLessThan(batch.indexOf(accounts));
}

/** Asserts nothing besides, possibly, a plain session revoke touched what the cleanup removes. */
export function expectNoTakeoverCleanup(statements: Statement[]): void {
	for (const table of DELETED_TABLES) {
		expect(writes(statements, 'delete', table), `delete from ${table}`).toEqual([]);
	}
	expect(writes(statements, 'update', 'api_keys')).toEqual([]);
}
