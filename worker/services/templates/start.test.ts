import { describe, expect, it } from 'vitest';
import { makeTemplateRow } from './fixtures';
import { resolveTemplateStart, type TemplateStartLookup } from './start';
import type { TemplateWithVersion } from '../../database/services/TemplateService';

function lookup(row: TemplateWithVersion | null, purchasedBy: string[] = []): TemplateStartLookup {
	return {
		getPublishedById: async () => row,
		hasPurchase: async (_templateId, userId) => purchasedBy.includes(userId),
	};
}

const SEED = {
	templateId: 'tpl1',
	versionId: 'ver2',
	name: 'Fernwood Socks',
	version: 2,
	snapshotKey: 'templates/tpl1/ver2/files.json',
};

describe('resolveTemplateStart', () => {
	it('seeds from the current version of a free template', async () => {
		await expect(resolveTemplateStart(lookup(makeTemplateRow({ priceCents: 0 })), 'tpl1', 'buyer')).resolves.toEqual({
			ok: true,
			seed: SEED,
		});
	});

	it.each([undefined, 42, ''])('treats %j as unavailable', async (templateId) => {
		await expect(resolveTemplateStart(lookup(makeTemplateRow()), templateId, 'buyer')).resolves.toEqual({
			ok: false,
			status: 404,
			error: 'This template is no longer available',
		});
	});

	it('reports an unlisted template as unavailable', async () => {
		await expect(resolveTemplateStart(lookup(null), 'tpl1', 'buyer')).resolves.toEqual({
			ok: false,
			status: 404,
			error: 'This template is no longer available',
		});
	});

	it('requires a purchase for a paid template', async () => {
		await expect(resolveTemplateStart(lookup(makeTemplateRow()), 'tpl1', 'buyer')).resolves.toEqual({
			ok: false,
			status: 402,
			error: 'Buy this template before using it',
		});
	});

	it('lets buyers and the creator use a paid template', async () => {
		await expect(resolveTemplateStart(lookup(makeTemplateRow(), ['buyer']), 'tpl1', 'buyer')).resolves.toMatchObject({ ok: true });
		await expect(resolveTemplateStart(lookup(makeTemplateRow()), 'tpl1', 'creator-private-id')).resolves.toMatchObject({ ok: true });
	});
});
