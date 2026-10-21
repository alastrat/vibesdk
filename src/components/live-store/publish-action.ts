import { t } from '@/lib/i18n';
import type { LiveStoreView } from '@/api-types';

/** What the publish button says for the address being edited, and whether there's anything to publish. */
export function publishAction(
	view: Pick<LiveStoreView, 'status' | 'slug' | 'hasChanges'> & { draft?: LiveStoreView['draft'] },
	slug: string,
): { label: string; disabled: boolean } {
	const named = view.draft ? t("Publish '{value1}'", { value1: view.draft.name }) : null;
	if (view.status !== 'live' || view.slug !== slug) return { label: named ?? t("Publish"), disabled: false };
	return view.hasChanges ? { label: named ?? t("Publish changes"), disabled: false } : { label: t("Up to date"), disabled: true };
}
