import type { ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { Button, CloudflareLogo, Sidebar, useSidebar } from '@cloudflare/kumo';
import { CompassIcon, GearSixIcon, HouseIcon, PackageIcon, ReceiptIcon, SparkleIcon, StorefrontIcon, UserIcon } from '@phosphor-icons/react';
import { EstoriLogo } from '@/brand';
import { useAuth } from '@/contexts/auth-context';
import { useApps, useFavoriteApps, useRecentApps } from '@/hooks/use-apps';
import { useFlag } from '@/hooks/use-flag';
import { AppActionsDropdown } from '@/components/shared/AppActionsDropdown';
import { useUsageLimitsBadgeState } from '@/components/usage-limits-badge';
import { startCloudflareConnect } from '@/lib/cloudflare-connect';
import { useI18n } from '@/lib/i18n';

/** The approved workspace navigation. Store tools belong to the store rail. */
export function AppSidebar() {
	const { t } = useI18n();
	const { user } = useAuth();
	const { pathname } = useLocation();
	const navigate = useNavigate();
	const { state, isMobile, setOpenMobile } = useSidebar();
	const collapsed = state === 'collapsed' && !isMobile;
	const { apps } = useApps();
	const { apps: favorites } = useFavoriteApps();
	const { apps: recent } = useRecentApps();
	const catalogPaused = useFlag('catalog-paused');
	const usageLimits = useUsageLimitsBadgeState();
	const showCloudflareCta = Boolean(user) && !usageLimits.billing && !usageLimits.hidden && !usageLimits.loading && (!usageLimits.hasUserToken || usageLimits.needsConfiguration);
	const cloudflareCtaLabel = usageLimits.needsConfiguration ? t('Configure AI Gateway') : t('Connect Cloudflare');
	const go = (path: string) => { navigate(path); if (isMobile) setOpenMobile(false); };
	const handleCloudflareCta = () => {
		if (usageLimits.needsConfiguration) go('/settings?config_needed=true');
		else void startCloudflareConnect(window.location.pathname + window.location.search);
	};
	const item = (label: string, href: string, icon: ReactNode, id?: string, count?: number) => (
		<Sidebar.MenuItem key={href}>
			<Sidebar.MenuButton id={id} href={href} tooltip={label} aria-label={collapsed ? label : undefined} active={href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`)} icon={icon} onClick={(event) => { event.preventDefault(); go(href); }}>
				<span>{label}</span>{!collapsed && count !== undefined && <span className="workspace-nav-count">{count}</span>}
			</Sidebar.MenuButton>
		</Sidebar.MenuItem>
	);
	const stores = (rows: typeof apps, label: string) => Boolean(user) && rows.length > 0 && !collapsed && (
		<Sidebar.Group>
			<Sidebar.GroupLabel>{label}</Sidebar.GroupLabel>
			<Sidebar.Menu>{rows.slice(0, 5).map((app) => {
				const owned = app.userId === user?.id;
				const path = owned ? `/stores/${encodeURIComponent(app.id)}` : `/app/${encodeURIComponent(app.id)}`;
				return <Sidebar.MenuItem key={app.id} className="group/row relative">
					<Sidebar.MenuButton href={path} tooltip={app.title} className="pr-9" icon={<StorefrontIcon size={17} />} active={pathname === path || pathname === `/chat/${app.id}`} onClick={(event) => { event.preventDefault(); go(path); }}><span className="truncate">{app.title || t('Untitled store')}</span></Sidebar.MenuButton>
					{owned && <div className="absolute right-1 top-1 opacity-0 group-hover/row:opacity-100 focus-within:opacity-100"><AppActionsDropdown appId={app.id} appTitle={app.title} size="sm" className="size-7" showOnHover={false} /></div>}
				</Sidebar.MenuItem>;
			})}</Sidebar.Menu>
		</Sidebar.Group>
	);
	return (
		<Sidebar className="workspace-sidebar workspace-navigation [--sidebar-bg:var(--color-kumo-recessed)]">
			<Sidebar.Header className="workspace-nav-identity">
				<Link to="/apps" onClick={() => { if (isMobile) setOpenMobile(false); }} aria-label={t('Estori workspace')} className="workspace-nav-brand">
					{collapsed ? <StorefrontIcon size={25} /> : <><EstoriLogo className="h-7 w-auto" /><span>{t('Your workspace')}</span></>}
				</Link>
			</Sidebar.Header>
			<Sidebar.Content>
				<Sidebar.Group><Sidebar.Menu>
					{item(t('Home'), '/', <HouseIcon size={20} />)}
					{item(t('Estori agent'), '/build', <SparkleIcon size={20} />)}
				</Sidebar.Menu></Sidebar.Group>
				<Sidebar.Group><Sidebar.GroupLabel>{t('Build & manage')}</Sidebar.GroupLabel><Sidebar.Menu>
					{item(t('My stores'), '/apps', <StorefrontIcon size={20} />, 'stores-link', apps.length)}
					{!catalogPaused && item(t('Catalog'), '/catalog', <PackageIcon size={20} />, 'catalog-link')}
					{user && item(t('Orders'), '/orders', <ReceiptIcon size={20} />, 'orders-link')}
				</Sidebar.Menu></Sidebar.Group>
				<Sidebar.Group><Sidebar.GroupLabel>{t('Explore')}</Sidebar.GroupLabel><Sidebar.Menu>{item(t('Discover'), '/discover', <CompassIcon size={20} />, 'discover-link')}</Sidebar.Menu></Sidebar.Group>
				{user && <Sidebar.Group><Sidebar.GroupLabel>{t('Your workspace')}</Sidebar.GroupLabel><Sidebar.Menu>
					{item(t('Profile'), '/profile', <UserIcon size={20} />)}
					{item(t('Settings'), '/settings', <GearSixIcon size={20} />)}
				</Sidebar.Menu></Sidebar.Group>}
				{stores(favorites, t('Favorites'))}
				{stores(recent.filter((app) => !favorites.some((favorite) => favorite.id === app.id)), t('Recent stores'))}
			</Sidebar.Content>
			<Sidebar.Footer className="workspace-nav-footer">
				{showCloudflareCta && (collapsed ? <Button variant="primary" shape="square" aria-label={cloudflareCtaLabel} title={cloudflareCtaLabel} onClick={handleCloudflareCta} icon={<CloudflareLogo variant="glyph" className="size-5" />} /> : <Button variant="primary" onClick={handleCloudflareCta} icon={<CloudflareLogo variant="glyph" className="size-5" />}>{cloudflareCtaLabel}</Button>)}
				<Sidebar.Trigger className="workspace-collapse-control" aria-label={collapsed ? t('Expand navigation') : t('Collapse navigation')} />
				{!collapsed && <span className="workspace-collapse-label">{t('Collapse navigation')}</span>}
			</Sidebar.Footer>
		</Sidebar>
	);
}
