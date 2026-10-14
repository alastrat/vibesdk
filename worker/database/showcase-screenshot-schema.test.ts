import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import * as schema from './schema';
import { AppService } from './services/AppService';
import { recordingD1 } from './test-support/recording-d1';
import { assignedValues, lastWrite } from './test-support/recorded-statements';

const migrations = import.meta.glob<string>('/migrations/*.sql', { query: '?raw', import: 'default', eager: true });

describe('showcase screenshot column', () => {
	it('adds a nullable showcase_screenshot_url to apps', () => {
		const column = getTableConfig(schema.apps).columns.find((c) => c.name === 'showcase_screenshot_url');
		expect(column).toBeDefined();
		expect(column?.notNull).toBe(false);
	});

	it('ships the column in a migration', () => {
		expect(Object.values(migrations).join('\n')).toContain('ALTER TABLE `apps` ADD `showcase_screenshot_url` text');
	});

	it('records a showcase screenshot on the app', async () => {
		const { d1, statements } = recordingD1();
		await new AppService({ DB: d1 } as unknown as Env).updateAppShowcaseScreenshot('app1', '/api/screenshots/app1/showcase.jpg');
		expect(assignedValues(lastWrite(statements, 'update', 'apps'))).toMatchObject({
			showcase_screenshot_url: '/api/screenshots/app1/showcase.jpg',
		});
	});

	it("leaves the app's updated time alone, so a capture never reorders Discover or a creator's apps", async () => {
		const { d1, statements } = recordingD1();
		await new AppService({ DB: d1 } as unknown as Env).updateAppShowcaseScreenshot('app1', '/api/screenshots/app1/showcase.jpg');
		expect(assignedValues(lastWrite(statements, 'update', 'apps'))).not.toHaveProperty('updated_at');
	});
});
