import { describe, expect, it } from 'vitest';
import { makeTemplate, makeTemplateRow, makeVersion } from '../../../services/templates/fixtures';
import {
    toCreatorTemplate,
    toPendingTemplateVersion,
    toPublicTemplateCard,
    toPublicTemplateDetail,
    toTemplateOrigin,
} from './templateDto';

describe('public template DTOs', () => {
    it('projects only gallery fields', () => {
        expect(toPublicTemplateCard(makeTemplateRow())).toEqual({
            id: 'tpl1',
            slug: 'fernwood-socks',
            name: 'Fernwood Socks',
            description: 'A cozy merino sock store.',
            category: 'store',
            priceCents: 2900,
            creatorName: 'Andres',
            useCount: 7,
            publishedAt: '2026-10-03T00:00:00.000Z',
            desktopShotUrl: '/api/templates/tpl1/screenshots/desktop?v=ver2',
            mobileShotUrl: '/api/templates/tpl1/screenshots/mobile?v=ver2',
        });
    });

    it('never exposes private ids, emails, commits or storage keys', () => {
        const json = JSON.stringify(toPublicTemplateDetail(makeTemplateRow()));
        for (const secret of ['creator-private-id', 'app-private-id', 'admin-private-id', 'deadbeefcafe', 'files.json', 'desktop.jpg']) {
            expect(json).not.toContain(secret);
        }
    });

    it('adds the version and file count on the detail page', () => {
        expect(toPublicTemplateDetail(makeTemplateRow())).toMatchObject({ version: 2, fileCount: 12 });
    });

    it('names an unknown creator', () => {
        expect(toPublicTemplateCard(makeTemplateRow({}, {}, null)).creatorName).toBe('Unknown');
    });
});

describe('creator and review DTOs', () => {
    it('lists a creator template with its newest version first', () => {
        const view = toCreatorTemplate(makeTemplate(), [
            makeVersion({ id: 'ver1', version: 1, status: 'superseded' }),
            makeVersion({ id: 'ver3', version: 3, status: 'pending', reviewedAt: null }),
            makeVersion(),
        ]);
        expect(view.versions.map((version) => version.id)).toEqual(['ver3', 'ver2', 'ver1']);
        expect(view.versions[0]).toEqual({
            id: 'ver3',
            version: 3,
            status: 'pending',
            rejectionReason: null,
            submittedAt: '2026-10-02T00:00:00.000Z',
            reviewedAt: null,
        });
        expect(view).toMatchObject({ priceCents: 2900, status: 'listed', currentVersionId: 'ver2' });
    });

    it('gives reviewers the creator, source app and review screenshots', () => {
        const pending = toPendingTemplateVersion({
            ...makeTemplateRow({}, { id: 'ver3', version: 3, status: 'pending' }),
            creatorEmail: 'creator@example.com',
        });
        expect(pending).toMatchObject({
            versionId: 'ver3',
            version: 3,
            templateId: 'tpl1',
            creatorEmail: 'creator@example.com',
            sourceAppId: 'app-private-id',
            desktopShotUrl: '/api/admin/template-versions/ver3/screenshots/desktop',
            mobileShotUrl: '/api/admin/template-versions/ver3/screenshots/mobile',
        });
    });

    it('describes where an app came from', () => {
        expect(toTemplateOrigin({ slug: 'fernwood-socks', name: 'Fernwood Socks', creatorName: null, status: 'unlisted' })).toEqual({
            slug: 'fernwood-socks',
            name: 'Fernwood Socks',
            creatorName: 'Unknown',
            listed: false,
        });
    });
});
