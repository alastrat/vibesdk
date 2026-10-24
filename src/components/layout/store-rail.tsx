import { Link, useNavigate } from 'react-router';
import { ArrowClockwiseIcon, PlusIcon, SquaresFourIcon, SparkleIcon, StorefrontIcon } from '@phosphor-icons/react';
import { Button, CloudflareLogo, Loader } from '@cloudflare/kumo';
import { useAuth } from '@/contexts/auth-context';
import { useApps } from '@/hooks/use-apps';
import { useUsageLimitsBadgeState } from '@/components/usage-limits-badge';
import { startCloudflareConnect } from '@/lib/cloudflare-connect';
import { useI18n } from '@/lib/i18n';
import type { StoreWorkspaceSection } from './store-workspace-location';

/** A compact, always-visible switcher replaces global navigation inside a store workspace. */
export function StoreRail({ appId, section }: { appId: string; section: StoreWorkspaceSection }) {
	const { t } = useI18n();
	const { user } = useAuth();
	const { apps, loading, error, refetch } = useApps();
	const navigate = useNavigate();
	const limits = useUsageLimitsBadgeState();
	const owned = user ? apps.filter((app) => app.userId === user.id) : [];
	const current = owned.find((app) => app.id === appId);
	const showCloudflare = Boolean(user) && !limits.billing && !limits.hidden && !limits.loading && (!limits.hasUserToken || limits.needsConfiguration);
	const cloudflareLabel = limits.needsConfiguration ? t('Configure AI Gateway') : t('Connect Cloudflare');
	const connect = () => {
		if (limits.needsConfiguration) navigate('/settings');
		else void startCloudflareConnect(window.location.pathname + window.location.search);
	};
	return (
		<aside className="workspace-store-rail" aria-label={t('Workspace and store switcher')}>
			<Link className="workspace-rail-control" to="/apps" title={t('All stores')} aria-label={t('Back to all stores')}><SquaresFourIcon size={22} /></Link>
			<div className="workspace-rail-divider" />
			<nav className="workspace-rail-stores" aria-label={t('My stores')}>
				{loading && <span className="workspace-rail-control" role="status" aria-label={t('Loading stores')}><Loader /></span>}
				{owned.map((app) => {
					const name = app.title.trim() || t('Untitled store');
					const initials = name.split(/\s+/).slice(0, 2).map((word) => Array.from(word)[0]).join('').toLocaleUpperCase();
					return <Link key={app.id} to={`/stores/${encodeURIComponent(app.id)}?section=${section}`} className="workspace-rail-control workspace-rail-store" aria-current={app.id === appId ? 'page' : undefined} aria-label={t('Switch to {store}', { store: name })} title={name}><span aria-hidden="true">{initials || <StorefrontIcon size={20} />}</span></Link>;
				})}
				{error && <Button variant="ghost" shape="square" icon={<ArrowClockwiseIcon size={18} />} aria-label={t('Retry')} title={t("Couldn't load your stores")} onClick={refetch} />}
			</nav>
			<Link className="workspace-rail-control workspace-rail-add" to="/build" title={t('New build')} aria-label={t('New build')}><PlusIcon size={21} /></Link>
			<div className="workspace-rail-bottom">
				{current && <Link className="workspace-rail-control" to={`/chat/${encodeURIComponent(current.id)}`} title={t('Open store builder')} aria-label={t('Open store builder')}><SparkleIcon size={22} /></Link>}
				{showCloudflare && <Button variant="ghost" shape="square" className="workspace-rail-control" onClick={connect} aria-label={cloudflareLabel} title={cloudflareLabel} icon={<CloudflareLogo variant="glyph" className="size-6" />} />}
			</div>
		</aside>
	);
}
