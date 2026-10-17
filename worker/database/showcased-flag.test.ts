import { describe, expect, it } from 'vitest';
import { AppService } from './services/AppService';
import { recordingD1 } from './test-support/recording-d1';
import { assignedValues, lastWrite } from './test-support/recorded-statements';

describe('AppService.setShowcased', () => {
	it('showcases only a public store that is still in Discover, without touching its updated time', async () => {
		const { d1, statements } = recordingD1();
		await new AppService({ DB: d1 } as unknown as Env).setShowcased('app1', true);
		const write = lastWrite(statements, 'update', 'apps');
		expect(assignedValues(write)).toEqual({ is_featured: 1 });
		const sql = write.sql.toLowerCase();
		expect(sql).toContain('"apps"."visibility" = ?');
		expect(sql).toContain('"apps"."removed_from_discover_at" is null');
		expect(write.params).toContain('public');
	});

	it('takes any store off the landing page', async () => {
		const { d1, statements } = recordingD1();
		await new AppService({ DB: d1 } as unknown as Env).setShowcased('app1', false);
		const write = lastWrite(statements, 'update', 'apps');
		expect(assignedValues(write)).toEqual({ is_featured: 0 });
		expect(write.sql.toLowerCase()).not.toContain('visibility');
	});
});
