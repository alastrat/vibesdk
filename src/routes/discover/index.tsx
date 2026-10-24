import { t, useI18n } from '@/lib/i18n';
import { useNavigate, useSearchParams } from 'react-router';
import { motion } from 'framer-motion';
import { usePaginatedApps } from '@/hooks/use-paginated-apps';
import { AppListContainer } from '@/components/shared/AppListContainer';
import { AppFiltersForm } from '@/components/shared/AppFiltersForm';
import { AppSortTabs } from '@/components/shared/AppSortTabs';
import {
	DISCOVER_PRICING_FILTERS,
	TEMPLATE_CATEGORIES,
	TEMPLATE_CATEGORY_LABELS,
	type AppSortOption,
	type DiscoverPricing,
	type TemplateCategory,
} from '@/api-types';
import { Select } from '@cloudflare/kumo';
import { GlobeIcon } from '@phosphor-icons/react';
import { BrandEmphasisIcon } from '@/components/shared/BrandEmphasisIcon';
import { PageMeta } from '@/components/public-site/solution-page';
import { DISCOVER_PAGE } from '@/content/public-pages';

export default function DiscoverPage() {
	useI18n();
	const navigate = useNavigate();
	const [searchParams, setSearchParams] = useSearchParams();

	// Derive initial sort from URL or localStorage, fallback to 'popular'
	const allowedSorts: AppSortOption[] = [
		'recent',
		'popular',
		'trending',
		'starred',
	];
	const sortParam = searchParams.get('sort') as AppSortOption | null;
	const savedSort = (
		typeof localStorage !== 'undefined'
			? localStorage.getItem('discover.sort')
			: null
	) as AppSortOption | null;
	const initialSort: AppSortOption =
		sortParam && allowedSorts.includes(sortParam)
			? sortParam
			: savedSort && allowedSorts.includes(savedSort)
				? savedSort
				: 'popular';

	const categoryParam = searchParams.get('category');
	const category: TemplateCategory | null = TEMPLATE_CATEGORIES.find((value) => value === categoryParam) ?? null;
	const pricing: DiscoverPricing =
		DISCOVER_PRICING_FILTERS.find((value) => value === searchParams.get('pricing')) ?? 'all';
	const setFilter = (key: 'category' | 'pricing', value: string) => {
		const next = new URLSearchParams(searchParams);
		if (value === 'all') next.delete(key);
		else next.set(key, value);
		setSearchParams(next, { replace: true });
	};

	const {
		// Filter state
		searchQuery,
		setSearchQuery,
		filterFramework,
		sortBy,
		period,

		// Data state
		apps,
		loading,
		loadingMore,
		error,
		totalCount,
		hasMore,

		// Form handlers
		handleSearchSubmit,
		handlePeriodChange,
		handleFrameworkChange,

		handleSortChange,

		// Pagination handlers

		refetch,
		loadMore,
	} = usePaginatedApps({
		type: 'public',
		defaultSort: initialSort,
		defaultPeriod: 'week',
		limit: 20,
		category,
		pricing,
	});

	return (
		<div className="workspace-discover size-full">
			<PageMeta {...DISCOVER_PAGE} />
			<div className="container max-w-6xl mx-auto px-4 py-8">
				<motion.div
					initial={{ opacity: 0, y: -20 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ duration: 0.5 }}
				>
					{/* Header */}
					<div className="workspace-discover-heading mb-7">
						<h1 className="flex items-center gap-2 text-[28px] font-semibold tracking-tight mb-3 text-kumo-strong">
							<BrandEmphasisIcon
								icon={GlobeIcon}
								weight="duotone"
								className="-rotate-30"
							/>{t("Discover")}</h1>
						<p className="text-kumo-subtle text-sm leading-6">
							{t(DISCOVER_PAGE.description)}
						</p>
					</div>

					<div className="flex flex-wrap items-start gap-3 justify-between mb-8">
						{/* Search and Filters */}
						<AppFiltersForm
							searchQuery={searchQuery}
							onSearchChange={setSearchQuery}
							onSearchSubmit={handleSearchSubmit}
							searchPlaceholder={t("Search apps...")}
							showSearchButton={true}
							filterFramework={filterFramework}
							period={period}
							onFrameworkChange={handleFrameworkChange}
							onPeriodChange={handlePeriodChange}
							sortBy={sortBy}
						/>

						<div className="flex flex-wrap gap-2">
                            <Select aria-label={t('Category')} value={category ?? 'all'} items={{ all: t('All categories'), ...Object.fromEntries(TEMPLATE_CATEGORIES.map(value => [value, t(TEMPLATE_CATEGORY_LABELS[value])])) }} onValueChange={value => { if (value) setFilter('category', value); }} />
                            <Select aria-label={t('Price')} value={pricing} items={{ all: t('Any price'), free: t('Free'), paid: t('Paid') }} onValueChange={value => { if (value) setFilter('pricing', value); }} />
                        </div>

						{/* Sort Tabs */}
						<AppSortTabs
							value={sortBy}
							onValueChange={(v) => {
								handleSortChange(v);
								// Persist to URL and localStorage
								try {
									localStorage.setItem('discover.sort', v);
								} catch {
									console.error(
										'Failed to persist sort to localStorage',
									);
								}
								const next = new URLSearchParams(searchParams);
								next.set('sort', v);
								setSearchParams(next, { replace: true });
							}}
							availableSorts={[
								'recent',
								'popular',
								'trending',
								'starred',
							]}
						/>
					</div>

					{/* Unified App List */}
					<AppListContainer
						apps={apps}
						loading={loading}
						loadingMore={loadingMore}
						error={error}
						hasMore={hasMore}
						totalCount={totalCount}
						sortBy={sortBy}
						onAppClick={(appId) => navigate(`/discover/${appId}`)}
						onLoadMore={loadMore}
						onRetry={refetch}
						showUser={true}
						showStats={true}
						infiniteScroll={true}
					/>
				</motion.div>
			</div>
		</div>
	);
}
