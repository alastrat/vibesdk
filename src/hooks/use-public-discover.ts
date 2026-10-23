import { useQuery } from '@tanstack/react-query';
import type { DiscoverCatalogFilters } from '@/api-types';
import { apiClient } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { unwrap } from '@/lib/unwrap-response';

export function useDiscoverCategories() {
 return useQuery({ queryKey: queryKeys.discoverCatalog.categories(), queryFn: () => unwrap(apiClient.getDiscoverCategories(), 'Could not load topics.'), staleTime: 60_000 });
}
export function useDiscoverCatalog(filters: DiscoverCatalogFilters, enabled = true) {
 return useQuery({ queryKey: queryKeys.discoverCatalog.list(filters), queryFn: () => unwrap(apiClient.getDiscoverCatalog(filters), 'Could not load Discover.'), staleTime: 60_000, enabled });
}
export function useDiscoverEntry(slug: string | null) {
 return useQuery({ queryKey: queryKeys.discoverCatalog.detail(slug ?? ''), queryFn: () => unwrap(apiClient.getDiscoverEntry(slug!), 'This item could not be loaded.'), enabled: !!slug, staleTime: 60_000, retry: false });
}
