import React from 'react';
import {
	BookmarkSimpleIcon,
	CaretRightIcon,
	CompassIcon,
	EnvelopeSimpleIcon,
	GlobeHemisphereWestIcon,
	LockKeyIcon,
	MagnifyingGlassIcon,
	PackageIcon,
	ReceiptIcon,
	PlusIcon,
	UsersThreeIcon,
} from '@phosphor-icons/react';
import { isValid } from 'date-fns';
import { Link, useLocation, useNavigate } from 'react-router';
import {
	Button,
	CloudflareLogo,
	InputGroup,
	Sidebar,
	cn,
	useSidebar,
} from '@cloudflare/kumo';
import { useAuth } from '@/contexts/auth-context';
import { useApps, useFavoriteApps, useRecentApps } from '@/hooks/use-apps';
import { AppActionsDropdown } from '@/components/shared/AppActionsDropdown';
import { OrangeButton } from '@/components/shared/OrangeButton';
import { useUsageLimitsBadgeState } from '@/components/usage-limits-badge';
import { ThemeToggle } from '@/components/theme-toggle';
import { startCloudflareConnect } from '@/lib/cloudflare-connect';
import { LEGAL_LINKS } from '@/content/legal/legal-documents';
import { legalLinkLabel } from '@/lib/legal-link-label';
import { t, tn } from '@/lib/i18n';
import { SELLER_ORDERS_PATH, SHOPPER_EMAILS_PATH } from '@/api-types';
import { useFlag } from '@/hooks/use-flag';

interface App {
	id: string;
	title: string;
	framework?: string | null;
	updatedAt: Date | string | null;
	updatedAtFormatted?: string;
	visibility: 'private' | 'team' | 'board' | 'public';
	userId?: string | null;
	isFavorite?: boolean;
}

interface Board {
	id: string;
	name: string;
	slug: string;
	memberCount: number;
	appCount: number;
	iconUrl?: string | null;
}

interface AppMenuItemProps {
	app: App;
	onClick: (id: string) => void;
	active?: boolean;
	variant?: 'recent' | 'bookmarked';
	showActions?: boolean;
	isCollapsed: boolean;
	getVisibilityIcon: (visibility: App['visibility']) => React.ReactNode;
	appPath: string;
}

function AppMenuItem({
	app,
	onClick,
	active = false,
	variant = 'recent',
	showActions = true,
	isCollapsed,
	getVisibilityIcon,
	appPath,
}: AppMenuItemProps) {
	const formatTimestamp = () => {
		const updatedAt =
			app.updatedAt instanceof Date
				? app.updatedAt
				: app.updatedAt
					? new Date(app.updatedAt)
					: null;

		if (updatedAt && isValid(updatedAt)) {
			const diffInSeconds = Math.floor(
				(Date.now() - updatedAt.getTime()) / 1000,
			);

			if (diffInSeconds < 60) return t('now');
			if (diffInSeconds < 3600)
				return t('{count}m ago', { count: Math.floor(diffInSeconds / 60) });
			if (diffInSeconds < 86400)
				return t('{count}h ago', { count: Math.floor(diffInSeconds / 3600) });
			if (diffInSeconds < 604800)
				return t('{count}d ago', { count: Math.floor(diffInSeconds / 86400) });
			if (diffInSeconds < 2592000)
				return t('{count}w ago', { count: Math.floor(diffInSeconds / 604800) });
			if (diffInSeconds < 31536000)
				return tn('{count}mo ago', '{count}mo ago', Math.floor(diffInSeconds / 2592000));
			return tn('{count}y ago', '{count}y ago', Math.floor(diffInSeconds / 31536000));
		}
		if (app.updatedAtFormatted) return app.updatedAtFormatted;
		return t('Recently');
	};

	return (
		<Sidebar.MenuItem className="group/app-item">
			<Sidebar.MenuButton
				active={active}
				href={appPath}
				tooltip={app.title}
				className="min-h-12 items-start py-2 pr-9 text-sm"
				onClick={(event) => {
					event.preventDefault();
					onClick(app.id);
				}}
			>
				<span className="flex min-w-0 flex-1 flex-col gap-1">
					<span className="flex min-w-0 items-center gap-1.5 text-kumo-default">
						{variant === 'bookmarked' && (
							<BookmarkSimpleIcon
								className="size-3.5 shrink-0"
								weight="duotone"
							/>
						)}
						<span className="truncate">{app.title}</span>
					</span>
					<span className="flex min-w-0 items-center gap-1.5 truncate text-xs font-normal text-kumo-subtle">
						<span className="shrink-0">
							{getVisibilityIcon(app.visibility)}
						</span>
						<span className="shrink-0">•</span>
						<span className="truncate">{formatTimestamp()}</span>
					</span>
				</span>
			</Sidebar.MenuButton>

			{!isCollapsed && showActions && (
				<div className="absolute right-1.5 top-1/2 z-10 -translate-y-1/2 opacity-0 transition-opacity group-hover/app-item:opacity-100 focus-within:opacity-100">
					<AppActionsDropdown
						appId={app.id}
						appTitle={app.title}
						size="sm"
						className="size-7"
						showOnHover={false}
					/>
				</div>
			)}
		</Sidebar.MenuItem>
	);
}

export function AppSidebar() {
	const { user } = useAuth();
	const navigate = useNavigate();
	const { pathname } = useLocation();
	const [searchQuery, setSearchQuery] = React.useState('');
	const { state } = useSidebar();
	const isCollapsed = state === 'collapsed';
	const usageLimits = useUsageLimitsBadgeState();
	const catalogPaused = useFlag('catalog-paused');
	// Show only when action is needed: not connected, or token without gateway.
	// Hide when configured even if cloudflareCredits is still null, and while
	// billing is on, where plans replace the seller's own Cloudflare account.
	const showCloudflareCta =
		Boolean(user) &&
		!usageLimits.billing &&
		!usageLimits.hidden &&
		!usageLimits.loading &&
		(!usageLimits.hasUserToken || usageLimits.needsConfiguration);
	const cloudflareCtaLabel = usageLimits.needsConfiguration
		? t('Configure AI Gateway')
		: t('Connect Cloudflare');

	const handleCloudflareCta = () => {
		if (usageLimits.needsConfiguration) {
			navigate('/settings');
			return;
		}

		void startCloudflareConnect(
			window.location.pathname + window.location.search,
		);
	};

	const { apps: recentApps, moreAvailable } = useRecentApps();
	const { apps: favoriteApps, loading: favoriteAppsLoading } =
		useFavoriteApps();
	const { apps: allApps, loading: allAppsLoading } = useApps();
	const getAppPath = (app: App) =>
		app.userId === user?.id ? `/chat/${app.id}` : `/app/${app.id}`;

	const boards: Board[] = [];

	const normalizedSearchQuery = searchQuery.toLowerCase().trim();
	const trimmedSearchQuery = searchQuery.trim();
	const isSearching = normalizedSearchQuery.length > 0;

	const favoriteAppIds = React.useMemo(
		() => new Set(favoriteApps.map((app) => app.id)),
		[favoriteApps],
	);

	const favoriteSearchResults = React.useMemo(() => {
		if (!normalizedSearchQuery) return [];

		return favoriteApps.filter((app) =>
			app.title.toLowerCase().includes(normalizedSearchQuery),
		);
	}, [favoriteApps, normalizedSearchQuery]);

	const appSearchResults = React.useMemo(() => {
		if (!normalizedSearchQuery) return [];

		return allApps.filter(
			(app) =>
				!favoriteAppIds.has(app.id) &&
				!app.isFavorite &&
				app.title.toLowerCase().includes(normalizedSearchQuery),
		);
	}, [allApps, favoriteAppIds, normalizedSearchQuery]);

	const appsWithoutBookmarks = React.useMemo(
		() =>
			recentApps.filter(
				(app) => !favoriteAppIds.has(app.id) && !app.isFavorite,
			),
		[recentApps, favoriteAppIds],
	);

	const showBookmarksSection = favoriteApps.length > 0;

	const showAppsSection =
		isSearching || appsWithoutBookmarks.length > 0 || moreAvailable;

	const bookmarkSearchEmptyMessage = t('No bookmarks found for "{query}"', { query: trimmedSearchQuery });

	const appSearchEmptyMessage =
		allApps.length === 0
			? t('No apps yet')
			: favoriteSearchResults.length > 0
				? t('No other apps found for "{query}"', { query: trimmedSearchQuery })
				: t('No apps found for "{query}"', { query: trimmedSearchQuery });

	const getVisibilityIcon = (visibility: App['visibility']) => {
		switch (visibility) {
			case 'private':
				return <LockKeyIcon className="size-3.5" weight="duotone" />;
			case 'team':
				return <UsersThreeIcon className="size-3.5" weight="duotone" />;
			case 'board':
			case 'public':
				return (
					<GlobeHemisphereWestIcon
						className="size-3.5"
						weight="duotone"
					/>
				);
		}
	};

	return (
		<Sidebar className="[--sidebar-bg:var(--color-kumo-canvas)]">
			<Sidebar.Header
				className={cn(
					'h-12',
					isCollapsed ? 'justify-center px-0' : 'justify-end px-3',
				)}
			>
				<Sidebar.Trigger
					aria-label={isCollapsed ? t('Open sidebar') : t('Collapse sidebar')}
					className="flex size-9 shrink-0 items-center justify-center"
				/>
			</Sidebar.Header>

			<div className="shrink-0 px-[11px] py-3 group-not-data-[state=collapsed]/sidebar:px-3.5">
				{isCollapsed ? (
					<div className="flex flex-col items-center gap-1">
						{pathname !== '/' && (
							<OrangeButton
								shape="square"
								aria-label={t('New build')}
								title={t('New build')}
								onClick={() => navigate('/')}
								className="size-8!"
								icon={
									<PlusIcon
										className="size-4"
										weight="bold"
									/>
								}
							/>
						)}
						<Button
							shape="square"
							size="base"
							variant="ghost"
							id="discover-link"
							aria-label={t('Discover')}
							title={t('Discover')}
							aria-current={
								pathname === '/discover' ? 'page' : undefined
							}
							onClick={() => navigate('/discover')}
							className={cn(
								'text-kumo-subtle hover:text-kumo-default',
								pathname === '/discover' &&
									'bg-(--sidebar-active-bg) text-kumo-default',
							)}
							icon={<CompassIcon className="size-4" />}
						/>
						{user && !catalogPaused && (
							<Button
								shape="square"
								size="base"
								variant="ghost"
								id="catalog-link"
								aria-label={t('Catalog')}
								title={t('Catalog')}
								aria-current={pathname === '/catalog' ? 'page' : undefined}
								onClick={() => navigate('/catalog')}
								className={cn(
									'text-kumo-subtle hover:text-kumo-default',
									pathname === '/catalog' && 'bg-(--sidebar-active-bg) text-kumo-default',
								)}
								icon={<PackageIcon className="size-4" />}
							/>
						)}
						{user && (
							<Button
								shape="square"
								size="base"
								variant="ghost"
								id="orders-link"
								aria-label={t('Orders')}
								title={t('Orders')}
								aria-current={pathname.startsWith(SELLER_ORDERS_PATH) ? 'page' : undefined}
								onClick={() => navigate(SELLER_ORDERS_PATH)}
								className={cn(
									'text-kumo-subtle hover:text-kumo-default',
									pathname.startsWith(SELLER_ORDERS_PATH) && 'bg-(--sidebar-active-bg) text-kumo-default',
								)}
								icon={<ReceiptIcon className="size-4" />}
							/>
						)}
						{user && (
							<Button
								shape="square"
								size="base"
								variant="ghost"
								id="emails-link"
								aria-label={t('Emails')}
								title={t('Emails')}
								aria-current={pathname.startsWith(SHOPPER_EMAILS_PATH) ? 'page' : undefined}
								onClick={() => navigate(SHOPPER_EMAILS_PATH)}
								className={cn(
									'text-kumo-subtle hover:text-kumo-default',
									pathname.startsWith(SHOPPER_EMAILS_PATH) && 'bg-(--sidebar-active-bg) text-kumo-default',
								)}
								icon={<EnvelopeSimpleIcon className="size-4" />}
							/>
						)}
					</div>
				) : (
					<div className="flex flex-col gap-1.5">
						<Sidebar.Menu className="gap-y-1.5">
							{pathname !== '/' && (
								<OrangeButton
									icon={
										<PlusIcon
											className="size-4"
											weight="bold"
										/>
									}
									title={t('New build')}
									onClick={() => {
										navigate('/');
									}}
									className="h-8! w-full justify-start text-sm"
								>
									{t('New build')}
								</OrangeButton>
							)}

							<Sidebar.MenuButton
								active={pathname === '/discover'}
								icon={
									<CompassIcon
										weight="duotone"
										className="size-4 -mr-1"
									/>
								}
								id="discover-link"
								tooltip={t('Discover')}
								onClick={() => navigate('/discover')}
							>
								{t('Discover')}
							</Sidebar.MenuButton>
							{user && !catalogPaused && (
								<Sidebar.MenuButton
									active={pathname === '/catalog'}
									icon={<PackageIcon weight="duotone" className="size-4 -mr-1" />}
									id="catalog-link"
									tooltip={t('Catalog')}
									onClick={() => navigate('/catalog')}
								>
									{t('Catalog')}
								</Sidebar.MenuButton>
							)}
							{user && (
								<Sidebar.MenuButton
									active={pathname.startsWith(SELLER_ORDERS_PATH)}
									icon={<ReceiptIcon weight="duotone" className="size-4 -mr-1" />}
									id="orders-link"
									tooltip={t('Orders')}
									onClick={() => navigate(SELLER_ORDERS_PATH)}
								>
									{t('Orders')}
								</Sidebar.MenuButton>
							)}
							{user && (
								<Sidebar.MenuButton
									active={pathname.startsWith(SHOPPER_EMAILS_PATH)}
									icon={<EnvelopeSimpleIcon weight="duotone" className="size-4 -mr-1" />}
									id="emails-link"
									tooltip={t('Emails')}
									onClick={() => navigate(SHOPPER_EMAILS_PATH)}
								>
									{t('Emails')}
								</Sidebar.MenuButton>
							)}
						</Sidebar.Menu>

						{user && (
							<div className="px-0.5">
								<InputGroup>
									<InputGroup.Addon>
										<MagnifyingGlassIcon className="size-4 text-kumo-subtle" />
									</InputGroup.Addon>
									<InputGroup.Input
										aria-label={t('Search apps')}
										placeholder={t('Search apps')}
										value={searchQuery}
										onChange={(event) =>
											setSearchQuery(event.target.value)
										}
									/>
								</InputGroup>
							</div>
						)}
					</div>
				)}
			</div>

			<Sidebar.Content>
				{!isCollapsed && showBookmarksSection && (
					<Sidebar.Group>
						<Sidebar.GroupLabel>
							<span className="text-xs font-funky-mono">
								{t('Bookmarked')}
							</span>
						</Sidebar.GroupLabel>
						<Sidebar.Menu>
							{isSearching ? (
								favoriteAppsLoading ? (
									<Sidebar.MenuItem>
										<div className="px-3 py-3 text-sm text-kumo-subtle">
											{t('Searching bookmarks...')}
										</div>
									</Sidebar.MenuItem>
								) : favoriteSearchResults.length > 0 ? (
									favoriteSearchResults.map((app) => (
										<AppMenuItem
											key={app.id}
											app={app}
											appPath={getAppPath(app)}
											active={
												pathname === getAppPath(app)
											}
											onClick={() =>
												navigate(getAppPath(app))
											}
											variant="bookmarked"
											isCollapsed={isCollapsed}
											getVisibilityIcon={
												getVisibilityIcon
											}
										/>
									))
								) : (
									<Sidebar.MenuItem>
										<div className="px-3 py-3 text-sm text-kumo-subtle">
											{bookmarkSearchEmptyMessage}
										</div>
									</Sidebar.MenuItem>
								)
							) : (
								favoriteApps.map((app) => (
									<AppMenuItem
										key={app.id}
										app={app}
										appPath={getAppPath(app)}
										active={pathname === getAppPath(app)}
										onClick={() =>
											navigate(getAppPath(app))
										}
										variant="bookmarked"
										isCollapsed={isCollapsed}
										getVisibilityIcon={getVisibilityIcon}
									/>
								))
							)}
						</Sidebar.Menu>
					</Sidebar.Group>
				)}

				{!isCollapsed && showAppsSection && (
					<Sidebar.Group>
						<Sidebar.GroupLabel>
							<span className="text-xs font-funky-mono">
								{t('Apps')}
							</span>
						</Sidebar.GroupLabel>
						<Sidebar.Menu>
							{isSearching ? (
								allAppsLoading ? (
									<Sidebar.MenuItem>
										<div className="px-3 py-3 text-sm text-kumo-subtle">
											{t('Searching apps...')}
										</div>
									</Sidebar.MenuItem>
								) : appSearchResults.length > 0 ? (
									appSearchResults.map((app) => (
										<AppMenuItem
											key={app.id}
											app={app}
											appPath={getAppPath(app)}
											active={
												pathname === getAppPath(app)
											}
											onClick={() =>
												navigate(getAppPath(app))
											}
											isCollapsed={isCollapsed}
											getVisibilityIcon={
												getVisibilityIcon
											}
										/>
									))
								) : (
									<Sidebar.MenuItem>
										<div className="px-3 py-3 text-sm text-kumo-subtle">
											{appSearchEmptyMessage}
										</div>
									</Sidebar.MenuItem>
								)
							) : (
								<>
									{appsWithoutBookmarks.map((app) => (
										<AppMenuItem
											key={app.id}
											app={app}
											appPath={getAppPath(app)}
											active={
												pathname === getAppPath(app)
											}
											onClick={() =>
												navigate(getAppPath(app))
											}
											isCollapsed={isCollapsed}
											getVisibilityIcon={
												getVisibilityIcon
											}
										/>
									))}
									{moreAvailable && (
										<Sidebar.MenuButton
											active={pathname === '/apps'}
											icon={CaretRightIcon}
											tooltip={t('View all apps')}
											onClick={() => navigate('/apps')}
										>
											{t('View all apps')}
										</Sidebar.MenuButton>
									)}
								</>
							)}
						</Sidebar.Menu>
					</Sidebar.Group>
				)}

				{!isCollapsed && boards.length > 0 && (
					<>
						<Sidebar.Separator />
						<Sidebar.Group>
							<Sidebar.Menu>
								<Sidebar.MenuItem>
									<Sidebar.Collapsible defaultOpen>
										<Sidebar.CollapsibleTrigger
											render={
												<Sidebar.MenuButton
													icon={UsersThreeIcon}
												>
													{t('My boards')}
													<Sidebar.MenuChevron />
												</Sidebar.MenuButton>
											}
										/>
										<Sidebar.CollapsibleContent>
											<Sidebar.MenuSub>
												{boards.map((board) => (
													<Sidebar.MenuSubButton
														key={board.id}
														onClick={() =>
															navigate(
																`/boards/${board.slug}`,
															)
														}
													>
														<span className="flex min-w-0 flex-col gap-0.5">
															<span className="truncate">
																{board.name}
															</span>
															<span className="truncate text-xs font-normal text-kumo-subtle">
																{tn('{count} member', '{count} members', board.memberCount)}
																{' / '}
																{tn('{count} app', '{count} apps', board.appCount)}
															</span>
														</span>
													</Sidebar.MenuSubButton>
												))}
												<Sidebar.MenuSubButton
													onClick={() =>
														navigate('/boards')
													}
												>
													{t('Browse all boards')}
												</Sidebar.MenuSubButton>
											</Sidebar.MenuSub>
										</Sidebar.CollapsibleContent>
									</Sidebar.Collapsible>
								</Sidebar.MenuItem>
							</Sidebar.Menu>
						</Sidebar.Group>
					</>
				)}
			</Sidebar.Content>

			<Sidebar.Footer className="h-auto p-3">
				<div className="flex w-full min-w-0 flex-col gap-2">
					{showCloudflareCta && (
						<OrangeButton
							onClick={handleCloudflareCta}
							aria-label={cloudflareCtaLabel}
							title={cloudflareCtaLabel}
							shape={isCollapsed ? 'square' : 'base'}
							className={cn(
								isCollapsed
									? 'size-8! shrink-0 self-center'
									: 'h-8! w-full justify-start gap-2 text-sm',
							)}
							icon={
								<CloudflareLogo
									variant="glyph"
									color="white"
									className="size-6 shrink-0"
								/>
							}
						>
							{!isCollapsed ? (
								<span className="truncate text-xs">
									{cloudflareCtaLabel}
								</span>
							) : null}
						</OrangeButton>
					)}
					{!isCollapsed && (
						<nav className="flex flex-wrap gap-x-3 gap-y-1 px-1 text-xs text-kumo-subtle">
							<Link to={'/pricing'} className="hover:text-kumo-default">{t('Pricing')}</Link>
							{LEGAL_LINKS.map((link) => (
								<Link key={link.slug} to={link.path} className="hover:text-kumo-default">
									{legalLinkLabel(link.slug)}
								</Link>
							))}
						</nav>
					)}
					<div
						className={cn(
							'flex min-w-0 w-full items-center gap-2',
							isCollapsed && 'flex-col',
						)}
					>
						<ThemeToggle
							align="end"
							className="size-9 shrink-0 rounded-lg"
						/>
					</div>
				</div>
			</Sidebar.Footer>
		</Sidebar>
	);
}
