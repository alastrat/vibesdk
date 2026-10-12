import { describe, expect, it } from 'vitest';
import deploySource from './deploy.ts?raw';

describe('deploy order', () => {
	const deploy = deploySource.slice(deploySource.indexOf('public async deploy(): Promise<void> {'));

	it('applies remote migrations after the build and before the new Worker goes live', () => {
		const migrate = deploy.indexOf('await this.runDatabaseMigrations();');
		expect(migrate).toBeGreaterThan(deploy.indexOf('await Promise.all(operations);'));
		expect(migrate).toBeLessThan(deploy.indexOf('await this.wranglerDeploy();'));
	});
});
