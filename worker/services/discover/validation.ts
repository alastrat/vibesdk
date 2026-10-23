import type { DiscoverCatalogFilters } from '../../../shared/types/discover-catalog';

export function catalogFilters(query: URLSearchParams): DiscoverCatalogFilters {
    const kind = query.get('kind') || undefined;
    const tier = query.get('tier') || undefined;
    const category = query.get('category') || undefined;
    const search = query.get('search')?.trim() || undefined;
    if (kind && kind !== 'store' && kind !== 'component') throw new Error('Invalid catalog kind');
    if (tier && tier !== 'free' && tier !== 'premium') throw new Error('Invalid catalog tier');
    if (category && !/^[a-z0-9-]{1,80}$/.test(category)) throw new Error('Invalid category');
    if (search && search.length > 120) throw new Error('Search must be at most 120 characters');
    const integer = (key: string, fallback: number, min: number, max: number) => {
        const raw = query.get(key);
        if (raw === null) return fallback;
        if (!/^\d+$/.test(raw)) throw new Error(`Invalid ${key}`);
        const value = Number(raw);
        if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Invalid ${key}`);
        return value;
    };
    return { kind: kind === 'store' || kind === 'component' ? kind : undefined, tier: tier === 'free' || tier === 'premium' ? tier : undefined, category, search, limit: integer('limit',48,1,60), offset: integer('offset',0,0,10000) };
}

// Even a preview opened directly is an opaque origin. Inline scripts support the standalone demos;
// network, forms, popups and navigation remain unavailable, including in an unsandboxed embedding.
export const DISCOVER_PREVIEW_CSP = "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";
