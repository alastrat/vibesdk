import { getLocale, t } from '@/lib/i18n';
import { formatUsd } from '@/lib/plans';
import type { DiscoverEntry, DiscoverCatalogFilters } from '@/api-types';

export const discoverPrice = (entry: Pick<DiscoverEntry, 'priceCents' | 'tier'>) => entry.tier === 'free' ? t('Free') : formatUsd(entry.priceCents, getLocale());

export function catalogFilters(params: URLSearchParams): DiscoverCatalogFilters {
 const kind = params.get('kind'); const tier = params.get('tier');
 return { search: (params.get('q') ?? '').slice(0, 120), category: params.get('category') ?? '', kind: kind === 'store' || kind === 'component' ? kind : undefined, tier: tier === 'free' || tier === 'premium' ? tier : undefined, limit: 48, offset: 0 };
}
