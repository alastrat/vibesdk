import type { LiveStoreView } from '@/api-types';

/** What the publish button says for the address being edited, and whether there's anything to publish. */
export function publishAction(view: Pick<LiveStoreView, 'status' | 'slug' | 'hasChanges'>, slug: string): { label: string; disabled: boolean } {
	if (view.status !== 'live' || view.slug !== slug) return { label: 'Publish', disabled: false };
	return view.hasChanges ? { label: 'Publish changes', disabled: false } : { label: 'Up to date', disabled: true };
}
