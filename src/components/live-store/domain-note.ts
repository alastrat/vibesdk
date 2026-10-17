import type { LiveStoreView } from '@/api-types';

/** What the panel says about a connected domain: its address only while the store is live, otherwise when it will be. */
export function connectedDomainNote(storeStatus: LiveStoreView['status']): { showAddress: boolean; note: string | null } {
	if (storeStatus === 'live') return { showAddress: true, note: null };
	if (storeStatus === 'offline') return { showAddress: false, note: 'Your store is offline. It opens on this domain again once you publish it.' };
	return { showAddress: false, note: 'Your store opens on this domain once you publish it.' };
}
