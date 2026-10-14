import { describe, expect, it } from 'vitest';
import { AppService } from './services/AppService';
import { recordingD1 } from './test-support/recording-d1';

describe('AppService.listAppsMissingShowcase', () => {
	it('picks deployed public stores still in Discover that have no showcase image, newest deploy first', async () => {
		const { d1, statements } = recordingD1((sql) => (sql.toLowerCase().includes('count(') ? [[5]] : [['app1'], ['app2']]));
		const result = await new AppService({ DB: d1 } as unknown as Env).listAppsMissingShowcase(2);
		expect(result).toEqual({ ids: ['app1', 'app2'], remaining: 3 });
		const select = statements
			.map((statement) => statement.sql.toLowerCase().replace(/\s+/g, ' '))
			.find((sql) => !sql.includes('count('));
		expect(select).toContain('"apps"."visibility" = ?');
		expect(select).toContain('"apps"."removed_from_discover_at" is null');
		expect(select).toContain('"apps"."last_deployed_at" is not null');
		expect(select).toContain('"apps"."showcase_screenshot_url" is null');
		expect(select).toContain('order by "apps"."last_deployed_at" desc');
		expect(select).toContain('limit ?');
	});
});
