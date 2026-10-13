/** App columns that never leave the worker in app lists: admin moderation and copy provenance. */

import type { App } from './schema';

export type InternalAppField =
	| 'removedFromDiscoverBy'
	| 'removedFromDiscoverReason'
	| 'reuseConsentAt'
	| 'parentAppId'
	| 'fromTemplateVersionId';

export function omitInternalAppFields<T extends Pick<App, InternalAppField>>(app: T): Omit<T, InternalAppField> {
	const {
		removedFromDiscoverBy: _removedFromDiscoverBy,
		removedFromDiscoverReason: _removedFromDiscoverReason,
		reuseConsentAt: _reuseConsentAt,
		parentAppId: _parentAppId,
		fromTemplateVersionId: _fromTemplateVersionId,
		...rest
	} = app;
	return rest;
}
