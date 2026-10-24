import { Link, useNavigate } from 'react-router';
import { Badge, Button, Input, Loader, Table } from '@cloudflare/kumo';
import {
	ArrowRightIcon,
	PlusIcon,
	StorefrontIcon,
} from '@phosphor-icons/react';
import { usePaginatedApps } from '@/hooks/use-paginated-apps';
import { pageTitle } from '@/brand';
import { t, tn, useI18n, getLocale } from '@/lib/i18n';
import { visibilityLabel } from '@/lib/visibility-label';
import { INTL_LOCALE } from 'shared/i18n/locales';

export default function AppsPage() {
	useI18n();
	const navigate = useNavigate();
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
	});
	return (
		<section className="workspace-stores">
			<title>{pageTitle(t('My stores'))}</title>
			<div className="workspace-stores-heading">
				<div>
					<h1>{t('My stores')}</h1>
					<p>
						{t(
							'A place for every idea. Manage the stores you are building.',
						)}
					</p>
				</div>
				<Button variant="primary" onClick={() => navigate('/build')}>
					<PlusIcon className="size-4" />
					{t('Create a store')}
				</Button>
			</div>
			<div className="workspace-store-list">
				<div className="workspace-stores-tools">
					<form onSubmit={handleSearchSubmit}>
						<Input
							aria-label={t('Search stores')}
							placeholder={t('Search stores')}
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
						/>
						<Button type="submit">{t('Search')}</Button>
					</form>
					<div
						className="flex gap-1"
						role="group"
						aria-label={t('Visibility')}
					>
						{(['all', 'private', 'public'] as const).map(
							(value) => (
								<Button
									key={value}
									variant={
										filterVisibility === value
											? 'secondary'
											: 'ghost'
									}
									aria-pressed={filterVisibility === value}
									onClick={() =>
										handleVisibilityChange(value)
									}
								>
									{value === 'all'
										? t('All stores')
										: visibilityLabel(value)}
								</Button>
							),
						)}
					</div>
				</div>
				{loading ? (
					<div className="workspace-stores-empty" role="status">
						<Loader />
						<p>{t('Loading your stores...')}</p>
					</div>
				) : error ? (
					<div className="workspace-stores-empty" role="alert">
						<h2>{t('Could not load your stores')}</h2>
						<p>{error}</p>
						<Button onClick={() => void refetch()}>
							{t('Try again')}
						</Button>
					</div>
				) : !apps.length ? (
					<div className="workspace-stores-empty">
						<StorefrontIcon className="size-10 text-kumo-subtle" />
						<h2>
							{searchQuery || filterVisibility !== 'all'
								? t('No stores found')
								: t('Your next idea starts here')}
						</h2>
						<p>
							{searchQuery || filterVisibility !== 'all'
								? t('Try another search or visibility filter.')
								: t(
										'Build your first store with Estori, then manage it here.',
									)}
						</p>
						<Button onClick={() => navigate('/build')}>
							{t('Create a store')}
						</Button>
					</div>
				) : (
					<div className="overflow-x-auto">
						<Table>
							<Table.Header>
								<Table.Row>
									<Table.Head>{t('Store')}</Table.Head>
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
								{apps.map((app) => (
									<Table.Row key={app.id}>
										<Table.Cell>
											<Link
												className="workspace-store-title"
												to={`/stores/${app.id}`}
											>
												<span className="workspace-store-mark">
													<StorefrontIcon className="size-5" />
												</span>
												<span>{app.title}</span>
											</Link>
										</Table.Cell>
										<Table.Cell>
											<Badge variant="secondary">
												{visibilityLabel(
													app.visibility,
												)}
											</Badge>
										</Table.Cell>
										<Table.Cell>
											{app.updatedAt &&
											Number.isFinite(
												new Date(
													app.updatedAt,
												).getTime(),
											)
												? new Date(
														app.updatedAt,
													).toLocaleDateString(
														INTL_LOCALE[
															getLocale()
														],
														{
															month: 'short',
															day: 'numeric',
															year: 'numeric',
														},
													)
												: '—'}
										</Table.Cell>
										<Table.Cell>
											<div className="flex justify-end gap-2">
												<Button
													variant="ghost"
													size="sm"
													onClick={() =>
														navigate(
															`/chat/${app.id}`,
														)
													}
												>
													{t('Edit store')}
												</Button>
												<Button
													size="sm"
													variant="secondary"
													aria-label={t(
														'Open {store}',
														{ store: app.title },
													)}
													onClick={() =>
														navigate(
															`/stores/${app.id}`,
														)
													}
												>
													<span className="hidden sm:inline">
														{t('Open')}
													</span>
													<ArrowRightIcon className="size-4" />
												</Button>
											</div>
										</Table.Cell>
									</Table.Row>
								))}
							</Table.Body>
						</Table>
					</div>
				)}
				{!loading && !error && (
					<div className="workspace-stores-foot">
						<span>
							{tn('{count} store', '{count} stores', totalCount)}
						</span>
						{hasMore && (
							<Button
								size="sm"
								disabled={loadingMore}
								onClick={() => void loadMore()}
							>
								{loadingMore ? t('Loading...') : t('Load more')}
							</Button>
						)}
					</div>
				)}
			</div>
		</section>
	);
}
