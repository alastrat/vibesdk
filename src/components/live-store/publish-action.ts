import type { LiveStoreView } from '@/api-types';

/** What the publish button says for the address being edited, and whether there's anything to publish. */
export function publishAction(
	view: Pick<LiveStoreView, 'status' | 'slug' | 'hasChanges'> & { draft?: LiveStoreView['draft'] },
	slug: string,
): { label: string; disabled: boolean } {
	const named = view.draft ? `Publish '${view.draft.name}'` : null;
	if (view.status !== 'live' || view.slug !== slug) return { label: named ?? 'Publish', disabled: false };
	return view.hasChanges ? { label: named ?? 'Publish changes', disabled: false } : { label: 'Up to date', disabled: true };
}
