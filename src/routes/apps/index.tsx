import { useState } from 'react';
import { Link } from 'react-router';
import {
	Badge,
	Button,
	Checkbox,
	Empty,
	Input,
	Loader,
	Select,
	Table,
	buttonVariants,
	LinkButton,
} from '@cloudflare/kumo';
import {
	ArrowRightIcon,
	CompassIcon,
	DownloadSimpleIcon,
	GlobeIcon,
	MagnifyingGlassIcon,
	PlusIcon,
	SparkleIcon,
	StorefrontIcon,
	XIcon,
} from '@phosphor-icons/react';
import { usePaginatedApps, type AppListData } from '@/hooks/use-paginated-apps';
import { useAuth } from '@/contexts/auth-context';
import { pageTitle } from '@/brand';
import { t, tn, useI18n, getLocale } from '@/lib/i18n';
import { visibilityLabel } from '@/lib/visibility-label';
import { INTL_LOCALE } from 'shared/i18n/locales';
import {
	TEMPLATE_CATEGORY_LABELS,
	type StorePublicationStatus,
} from '@/api-types';
import { downloadStoreList, storeListCsv } from './store-list-export';

function publicationOf(app: AppListData) {
	return 'publication' in app ? app.publication : undefined;
}
function statusLabel(status?: StorePublicationStatus) {
	return status === 'live'
		? t('Live')
		: status === 'offline'
			? t('Offline')
			: status === 'draft'
				? t('Draft')
				: t('Status unavailable');
}
function categoryLabel(app: AppListData) {
	return app.category ? t(TEMPLATE_CATEGORY_LABELS[app.category]) : '—';
}
function updatedLabel(app: AppListData) {
	const date = app.updatedAt ? new Date(app.updatedAt) : null;
	return date && Number.isFinite(date.getTime())
		? date.toLocaleDateString(INTL_LOCALE[getLocale()], {
				month: 'short',
				day: 'numeric',
				year: 'numeric',
			})
		: '—';
}

export default function AppsPage() {
	const { user } = useAuth();
	return <StoreList key={user?.id ?? 'anonymous'} />;
}

function StoreList() {
	useI18n();
	const [publication, setPublication] = useState<
		StorePublicationStatus | 'all'
	>('all');
	const [selected, setSelected] = useState<Set<string>>(() => new Set());
	const {
		apps,
		loading,
		loadingMore,
		error,
		totalCount,
		hasMore,
		searchQuery,
		setSearchQuery,
		handleSearchSubmit,
		filterVisibility,
		handleVisibilityChange,
		refetch,
		loadMore,
	} = usePaginatedApps({
		type: 'user',
		defaultSort: 'recent',
		includeVisibility: true,
		limit: 20,
		publication: publication === 'all' ? undefined : publication,
	});
	const selectedApps = apps.filter((app) => selected.has(app.id));
	const allSelected = apps.length > 0 && selectedApps.length === apps.length;
	const filtered = Boolean(
		searchQuery || filterVisibility !== 'all' || publication !== 'all',
	);
	const hasCategory = apps.some((app) => app.category);
	const updateSearch = (value: string) => {
		setSearchQuery(value);
		setSelected(new Set());
	};
	const clearFilters = () => {
		updateSearch('');
		handleVisibilityChange('all');
		setPublication('all');
	};
	const toggle = (id: string, checked: boolean) =>
		setSelected((current) => {
			const next = new Set(current);
			if (checked) next.add(id);
			else next.delete(id);
			return next;
		});
	const exportSelected = () =>
		downloadStoreList(
			storeListCsv(
				[
					t('Store'),
					t('Publication status'),
					t('Visibility'),
					...(hasCategory ? [t('Category')] : []),
					t('Last updated'),
				],
				selectedApps.map((app) => [
					app.title || t('Untitled store'),
					statusLabel(publicationOf(app)?.status),
					visibilityLabel(app.visibility),
					...(hasCategory ? [categoryLabel(app)] : []),
					updatedLabel(app),
				]),
			),
		);
	return (
		<section className="workspace-stores w-full">
			<title>{pageTitle(t('My stores'))}</title>
			<header className="mb-7 flex flex-wrap items-start justify-between gap-4">
				<div className="grid gap-3">
					<div className="flex items-center gap-3">
						<span className="grid size-10 place-items-center rounded-xl border border-kumo-line bg-kumo-base text-kumo-brand">
							<GlobeIcon size={23} weight="fill" />
						</span>
						<h1>{t('My stores')}</h1>
					</div>
					<p className="text-sm text-kumo-subtle">
						{t(
							'A place for every idea. Manage the stores you are building.',
						)}
					</p>
				</div>
				<div className="flex flex-wrap gap-2">
					<Link
						to="/discover"
						className={buttonVariants({
							variant: 'secondary',
							size: 'sm',
						})}
					>
						<CompassIcon size={17} />
						{t('Browse Discover')}
					</Link>
					<LinkButton href="/build" variant="primary" size="sm">
						<PlusIcon size={17} />
						{t('Create a store')}
					</LinkButton>
				</div>
			</header>
			<div className="overflow-hidden rounded-xl border border-kumo-line bg-kumo-base">
				<div className="flex flex-wrap items-center justify-between gap-4 border-b border-kumo-line px-4 py-3">
					<div className="flex flex-wrap items-center gap-3">
						<span className="text-xs font-medium text-kumo-subtle">
							{t('View')}
						</span>
						<div
							className="flex flex-wrap gap-1"
							role="group"
							aria-label={t('Publication status')}
						>
							{(['all', 'live', 'offline', 'draft'] as const).map(
								(value) => (
									<Button
										key={value}
										size="sm"
										variant={
											publication === value
												? 'secondary'
												: 'ghost'
										}
										aria-pressed={publication === value}
										onClick={() => {
											setPublication(value);
											setSelected(new Set());
										}}
									>
										{value === 'all'
											? t('All stores')
											: statusLabel(value)}
									</Button>
								),
							)}
						</div>
					</div>
					<Select
						size="sm"
						aria-label={t('Visibility')}
						value={filterVisibility}
						items={{
							all: t('All visibility'),
							private: t('Private'),
							public: t('Public'),
						}}
						onValueChange={(value) => {
							if (value) {
								handleVisibilityChange(value);
								setSelected(new Set());
							}
						}}
					/>
				</div>
				<form
					className="flex flex-wrap items-center gap-2 border-b border-kumo-line p-4"
					onSubmit={handleSearchSubmit}
				>
					<MagnifyingGlassIcon
						size={19}
						className="shrink-0 text-kumo-subtle"
						aria-hidden="true"
					/>
					<Input
						size="sm"
						type="search"
						aria-label={t('Search stores')}
						placeholder={t('Find a store by name')}
						value={searchQuery}
						onChange={(event) => updateSearch(event.target.value)}
						className="min-w-40 flex-1 sm:max-w-md"
					/>
					{searchQuery && (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							shape="square"
							aria-label={t('Clear search')}
							onClick={() => updateSearch('')}
						>
							<XIcon size={17} />
						</Button>
					)}
					<Button type="submit" variant="secondary" size="sm">
						{t('Search')}
					</Button>
					{filtered && (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={clearFilters}
						>
							{t('Clear filters')}
						</Button>
					)}
				</form>
				{!loading && !error && apps.length > 0 && (
					<div className="flex flex-wrap items-center justify-between gap-3 border-b border-kumo-line px-4 py-3 text-xs">
						<div className="flex flex-wrap items-center gap-3">
							<strong
								className="font-medium text-kumo-default"
								aria-live="polite"
							>
								{selectedApps.length
									? tn(
											'{count} store selected',
											'{count} stores selected',
											selectedApps.length,
										)
									: tn(
											'{count} store',
											'{count} stores',
											totalCount,
										)}
							</strong>
							{selectedApps.length > 0 && (
								<>
									<Button
										variant="secondary"
										size="xs"
										onClick={exportSelected}
									>
										<DownloadSimpleIcon size={15} />
										{t('Export selected')}
									</Button>
									<Button
										variant="ghost"
										size="xs"
										onClick={() => setSelected(new Set())}
									>
										{t('Clear selection')}
									</Button>
								</>
							)}
						</div>
						<span className="text-kumo-subtle">
							{t('Showing {shown} of {total}', {
								shown: apps.length,
								total: totalCount,
							})}
						</span>
					</div>
				)}
				{loading ? (
					<div
						className="flex items-center justify-center gap-3 px-5 py-16 text-sm text-kumo-subtle"
						role="status"
					>
						<Loader />
						{t('Loading your stores...')}
					</div>
				) : error ? (
					<div className="p-10" role="alert">
						<Empty
							title={t('Could not load your stores')}
							description={error}
							contents={
								<Button
									variant="secondary"
									onClick={() => void refetch()}
								>
									{t('Try again')}
								</Button>
							}
						/>
					</div>
				) : !apps.length ? (
					<div className="workspace-stores-empty-panel">
						<Empty
							icon={<StorefrontIcon size={35} />}
							title={
								filtered
									? t('No stores found')
									: t('Your next idea starts here')
							}
							description={
								filtered
									? t(
											'Try another search or clear your filters.',
										)
									: t(
											'Build your first store with Estori, then manage it here.',
										)
							}
							contents={
								filtered ? (
									<Button
										variant="secondary"
										onClick={clearFilters}
									>
										{t('Clear filters')}
									</Button>
								) : (
									<LinkButton href="/build" variant="primary">
										{t('Create a store')}
									</LinkButton>
								)
							}
						/>
					</div>
				) : (
					<div className="overflow-x-auto">
						<Table className="text-sm">
							<caption className="sr-only">
								{t('Your stores and publication status')}
							</caption>
							<Table.Header className="bg-kumo-recessed">
								<Table.Row>
									<Table.Head className="w-12">
										<Checkbox
											aria-label={t(
												'Select all loaded stores',
											)}
											checked={allSelected}
											indeterminate={
												selectedApps.length > 0 &&
												!allSelected
											}
											onCheckedChange={(checked) =>
												setSelected(
													checked
														? new Set(
																apps.map(
																	(app) =>
																		app.id,
																),
															)
														: new Set(),
												)
											}
										/>
									</Table.Head>
									<Table.Head>{t('Store')}</Table.Head>
									<Table.Head>
										{t('Publication status')}
									</Table.Head>
									{hasCategory && (
										<Table.Head>{t('Category')}</Table.Head>
									)}
									<Table.Head>{t('Visibility')}</Table.Head>
									<Table.Head>{t('Last updated')}</Table.Head>
									<Table.Head>
										<span className="sr-only">
											{t('Actions')}
										</span>
									</Table.Head>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{apps.map((app) => {
									const name =
										app.title.trim() || t('Untitled store');
									const state = publicationOf(app)?.status;
									const path = `/stores/${encodeURIComponent(app.id)}`;
									const initials = name
										.split(/\s+/)
										.slice(0, 2)
										.map((word) => Array.from(word)[0])
										.join('')
										.toLocaleUpperCase();
									return (
										<Table.Row
											key={app.id}
											className={
												selected.has(app.id)
													? 'bg-kumo-tint'
													: 'hover:bg-kumo-tint/50'
											}
										>
											<Table.Cell>
												<Checkbox
													aria-label={t(
														'Select {store}',
														{ store: name },
													)}
													checked={selected.has(
														app.id,
													)}
													onCheckedChange={(
														checked,
													) =>
														toggle(app.id, checked)
													}
												/>
											</Table.Cell>
											<Table.Cell>
												<Link
													to={path}
													className="flex min-w-48 items-center gap-3 py-2 font-medium text-kumo-strong"
												>
													<span
														className="grid size-9 shrink-0 place-items-center rounded-lg border border-kumo-line bg-kumo-tint text-xs font-semibold text-kumo-brand"
														aria-hidden="true"
													>
														{initials}
													</span>
													<span className="max-w-72 truncate">
														{name}
													</span>
												</Link>
											</Table.Cell>
											<Table.Cell>
												<Badge
													variant={
														state === 'live'
															? 'success'
															: 'secondary'
													}
												>
													{statusLabel(state)}
												</Badge>
											</Table.Cell>
											{hasCategory && (
												<Table.Cell className="text-kumo-subtle">
													{categoryLabel(app)}
												</Table.Cell>
											)}
											<Table.Cell className="text-kumo-subtle">
												{visibilityLabel(
													app.visibility,
												)}
											</Table.Cell>
											<Table.Cell className="whitespace-nowrap text-kumo-subtle">
												{updatedLabel(app)}
											</Table.Cell>
											<Table.Cell>
												<div className="flex justify-end gap-2">
													<Link
														to={`/chat/${encodeURIComponent(app.id)}`}
														className={buttonVariants(
															{
																variant:
																	'ghost',
																size: 'sm',
															},
														)}
													>
														{t('Edit store')}
													</Link>
													<Link
														to={path}
														aria-label={t(
															'Open {store}',
															{ store: name },
														)}
														className={buttonVariants(
															{
																variant:
																	'ghost',
																size: 'sm',
															},
														)}
													>
														<ArrowRightIcon
															size={18}
														/>
													</Link>
												</div>
											</Table.Cell>
										</Table.Row>
									);
								})}
							</Table.Body>
						</Table>
					</div>
				)}
				{!loading && !error && hasMore && (
					<div className="flex justify-center border-t border-kumo-line p-3">
						<Button
							variant="secondary"
							size="sm"
							disabled={loadingMore}
							loading={loadingMore}
							onClick={() => void loadMore()}
						>
							{t('Load more stores')}
						</Button>
					</div>
				)}
			</div>
			<p className="mt-3 text-xs leading-5 text-kumo-subtle">
				{t(
					'Live stores are open to shoppers. Offline stores have been taken offline; drafts have never been published. Visibility controls who can view the app in Estori.',
				)}
			</p>
			<aside className="mt-8 flex flex-wrap items-center gap-4 rounded-xl border border-kumo-line bg-kumo-recessed p-5">
				<span className="grid size-10 shrink-0 place-items-center rounded-xl bg-kumo-base text-kumo-brand">
					<SparkleIcon size={22} />
				</span>
				<div className="min-w-40 flex-1">
					<h2 className="text-sm font-semibold text-kumo-strong">
						{t('Your next idea starts with a conversation.')}
					</h2>
					<p className="mt-1 text-sm text-kumo-subtle">
						{t(
							'Describe what you have in mind. Estori helps you bring it to life.',
						)}
					</p>
				</div>
				<Link
					to="/build"
					className={buttonVariants({
						variant: 'secondary',
						size: 'sm',
					})}
				>
					{t('Ask Estori')}
					<ArrowRightIcon size={16} />
				</Link>
			</aside>
		</section>
	);
}
