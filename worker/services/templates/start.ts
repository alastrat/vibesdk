/** Resolve the template a user asked to start from into the seed the agent copies. */

import type { TemplateSeed } from '../../agents/core/types';
import type { TemplateWithVersion } from '../../database/services/TemplateService';
import { PURCHASE_REQUIRED_ERROR, TEMPLATE_UNAVAILABLE_MESSAGE, canUseTemplate } from './catalog';

export interface TemplateStartLookup {
	getPublishedById(templateId: string): Promise<TemplateWithVersion | null>;
	hasPurchase(templateId: string, userId: string): Promise<boolean>;
}

export type TemplateStartResult =
	| { ok: true; seed: TemplateSeed }
	| { ok: false; status: 402 | 404; error: string };

const UNAVAILABLE: TemplateStartResult = { ok: false, status: 404, error: TEMPLATE_UNAVAILABLE_MESSAGE };

export async function resolveTemplateStart(
	lookup: TemplateStartLookup,
	templateId: unknown,
	userId: string,
): Promise<TemplateStartResult> {
	if (typeof templateId !== 'string' || templateId.length === 0) return UNAVAILABLE;
	const row = await lookup.getPublishedById(templateId);
	if (!row) return UNAVAILABLE;

	const isCreator = row.template.creatorUserId === userId;
	const needsPurchase = row.template.priceCents > 0 && !isCreator;
	const hasPurchase = needsPurchase ? await lookup.hasPurchase(row.template.id, userId) : false;
	if (!canUseTemplate({ priceCents: row.template.priceCents, isCreator, hasPurchase })) {
		return { ok: false, status: 402, error: PURCHASE_REQUIRED_ERROR };
	}
	return {
		ok: true,
		seed: {
			templateId: row.template.id,
			versionId: row.version.id,
			name: row.template.name,
			version: row.version.version,
			snapshotKey: row.version.snapshotKey,
		},
	};
}
