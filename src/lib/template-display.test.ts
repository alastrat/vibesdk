import { describe, expect, it } from 'vitest';
import type { CreatorTemplate, CreatorTemplateVersion } from '@/api-types';
import { formatFileSize, templateStatusView } from './template-display';

function version(overrides: Partial<CreatorTemplateVersion>): CreatorTemplateVersion {
	return {
		id: 'v1',
		version: 1,
		status: 'approved',
		rejectionReason: null,
		submittedAt: null,
		reviewedAt: null,
		...overrides,
	};
}

function template(overrides: Partial<CreatorTemplate>): CreatorTemplate {
	return {
		id: 'tpl1',
		slug: 'fernwood',
		name: 'Fernwood',
		description: 'A cozy merino sock store.',
		category: 'store',
		priceCents: 0,
		status: 'unlisted',
		useCount: 0,
		currentVersionId: null,
		versions: [],
		...overrides,
	};
}

describe('templateStatusView', () => {
	it('shows a first version in review', () => {
		expect(templateStatusView(template({ versions: [version({ id: 'v1', status: 'pending' })] }))).toEqual({
			label: 'In review',
			variant: 'warning',
			detail: 'Version 1 is in review',
			pendingVersionId: 'v1',
			canUnlist: false,
		});
	});

	it('shows a published template with an update in review', () => {
		const view = templateStatusView(
			template({
				status: 'listed',
				currentVersionId: 'v1',
				versions: [version({ id: 'v2', version: 2, status: 'pending' }), version({ id: 'v1' })],
			}),
		);
		expect(view).toEqual({
			label: 'Published',
			variant: 'success',
			detail: 'Version 2 is in review',
			pendingVersionId: 'v2',
			canUnlist: true,
		});
	});

	it('shows the reviewer reason on a rejection', () => {
		expect(
			templateStatusView(template({ versions: [version({ status: 'rejected', rejectionReason: 'Uses a real brand logo' })] })),
		).toMatchObject({ label: 'Rejected', variant: 'error', detail: 'Uses a real brand logo', canUnlist: false });
	});

	it('shows an approved template that was unlisted', () => {
		expect(templateStatusView(template({ currentVersionId: 'v1', versions: [version({})] }))).toMatchObject({
			label: 'Unlisted',
			variant: 'secondary',
		});
	});

	it('shows a withdrawn first version', () => {
		expect(templateStatusView(template({ versions: [version({ status: 'withdrawn' })] }))).toMatchObject({
			label: 'Withdrawn',
			variant: 'secondary',
		});
	});
});

describe('formatFileSize', () => {
	it.each([
		[512, '512 B'],
		[2048, '2.0 KB'],
		[10 * 1024 * 1024, '10.0 MB'],
	])('formats %i bytes', (bytes, text) => {
		expect(formatFileSize(bytes)).toBe(text);
	});
});
