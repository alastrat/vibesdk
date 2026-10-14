import { describe, expect, it } from 'vitest';
import { TemplateService } from './services/TemplateService';
import { recordingD1 } from './test-support/recording-d1';

function service(rows: unknown[][]) {
	const { d1, statements } = recordingD1(rows);
	return { templates: new TemplateService({ DB: d1 } as unknown as Env), statements };
}

describe('TemplateService.getPaidCopyOrigin', () => {
	it("reads the creator of the listing behind the app's paid version", async () => {
		const { templates, statements } = service([['v1', 'seller']]);
		expect(await templates.getPaidCopyOrigin('app1')).toEqual({ creatorUserId: 'seller' });
		const sql = statements[0].sql.toLowerCase().replace(/\s+/g, ' ');
		expect(sql).toContain(
			'left join "template_versions" on "template_versions"."id" = "apps"."from_template_version_id"',
		);
		expect(sql).toContain('left join "templates" on "templates"."id" = "template_versions"."template_id"');
		expect(statements[0].params).toContain('app1');
	});

	it('still reports a copy whose paid listing was deleted, without a creator', async () => {
		const { templates } = service([['v1', null]]);
		expect(await templates.getPaidCopyOrigin('app1')).toEqual({ creatorUserId: null });
	});

	it('is null for an app not copied from a paid version, or a missing app', async () => {
		expect(await service([[null, null]]).templates.getPaidCopyOrigin('app1')).toBeNull();
		expect(await service([]).templates.getPaidCopyOrigin('missing')).toBeNull();
	});
});
