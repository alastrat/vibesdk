import { describe, expect, it } from 'vitest';
import { AppService } from './services/AppService';
import { recordingD1 } from './test-support/recording-d1';

describe('AppService.getAppDetails', () => {
	it("counts the site's uses as the apps copied from it, the same count Discover shows", async () => {
		const { d1, statements } = recordingD1();
		await new AppService({ DB: d1 } as unknown as Env).getAppDetails('app1');
		const sql = statements[0].sql.toLowerCase().replace(/\s+/g, ' ');
		expect(sql).toContain(
			'"users"."avatar_url", (select count(*) from "apps" as forks where forks.parent_app_id = "apps"."id") from "apps"',
		);
	});
});
