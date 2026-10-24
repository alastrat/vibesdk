/** The owner's collection from the last published version. No raw files or supplier identifiers. */
export interface StoreWorkspaceVariant {
	id: string;
	name: string;
	priceCents: number;
	/** The published availability setting, not an inventory or supplier stock check. */
	available: boolean;
	kind: 'own' | 'catalog';
}

export interface StoreWorkspaceProduct {
	id: string;
	name: string;
	description: string | null;
	imageUrl: string | null;
	variants: StoreWorkspaceVariant[];
}

export interface StoreWorkspaceProducts {
	appId: string;
	source: 'published';
	status: 'unpublished' | 'live' | 'offline';
	manifestStatus: 'unpublished' | 'missing' | 'invalid' | 'ready';
	publishedAt: string | null;
	publishedCommit: string | null;
	storeUrl: string | null;
	currency: 'usd';
	products: StoreWorkspaceProduct[];
}
