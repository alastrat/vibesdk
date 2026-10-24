import type { StoreManifestProduct } from '../../../../shared/types/store-payments';
import type { StoreWorkspaceProduct } from '../../../../shared/types/store-workspace';

/** Resolve store paths only against this store. Never render executable URLs, credentials or mixed content. */
export function productImageUrl(image: string | undefined, storeUrl: string | null): string | null {
	if (!image || image.startsWith('//') || image.includes('\\') || Array.from(image).some((character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127)) return null;
	try {
		const relative = image.startsWith('/');
		if (relative && !storeUrl) return null;
		const url = new URL(image, storeUrl ?? undefined);
		if (url.username || url.password) return null;
		if (relative && storeUrl && url.origin !== new URL(storeUrl).origin) return null;
		if (url.protocol !== 'https:') {
			const local = url.hostname === 'localhost' || url.hostname.endsWith('.localhost');
			if (url.protocol !== 'http:' || !local || !storeUrl || url.origin !== new URL(storeUrl).origin) return null;
		}
		return url.href;
	} catch {
		return null;
	}
}

export function productView(product: StoreManifestProduct, storeUrl: string | null): StoreWorkspaceProduct {
	return {
		id: product.id,
		name: product.name,
		description: product.description ?? null,
		imageUrl: productImageUrl(product.image, storeUrl),
		variants: product.variants.map((variant) => ({
			id: variant.id,
			name: variant.name,
			priceCents: variant.priceCents,
			available: variant.available !== false,
			kind: variant.catalogVariantId ? 'catalog' : 'own',
		})),
	};
}
