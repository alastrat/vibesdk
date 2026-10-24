import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Badge, Button } from '@cloudflare/kumo';
import { ArrowUpRightIcon, GlobeIcon, SparkleIcon, StarIcon } from '@phosphor-icons/react';
import type { AppDetailsData } from '@/api-types';
import { GoLiveDialog } from '@/components/live-store/GoLiveDialog';
import { AppActionsDropdown } from '@/components/shared/AppActionsDropdown';
import { useLiveStore } from '@/hooks/use-live-store';
import { useToggleAppFavorite } from '@/hooks/use-app';
import { t, useI18n } from '@/lib/i18n';

/** Reuses the same publication, domain and app actions as the builder. */
export function StoreSettingsPanel({ app }: { app: AppDetailsData }) {
	useI18n();
	const navigate = useNavigate();
	const [publishingOpen, setPublishingOpen] = useState(false);
	const live = useLiveStore(app.id, true);
	const favorite = useToggleAppFavorite(app.id);
	return (
		<div className="es-settings-grid">
			<section className="es-settings-section">
				<div className="es-settings-heading"><GlobeIcon size={22} /><h2>{t('Publishing and domains')}</h2></div>
				<p>{t('Manage your live address, publish changes, and connect your own domain.')}</p>
				{live.data && <div className="flex flex-wrap items-center gap-3"><Badge variant={live.data.status === 'live' ? 'success' : 'secondary'}>{live.data.status === 'live' ? t('Live') : live.data.status === 'offline' ? t('Offline') : t('Not published')}</Badge>{live.data.url && <a className="es-text-link break-all" href={live.data.url} target="_blank" rel="noreferrer">{live.data.url}<ArrowUpRightIcon size={16} /></a>}</div>}
				{live.error && <p role="alert" className="text-kumo-danger">{live.error.message}</p>}
				<Button className="w-fit" onClick={() => setPublishingOpen(true)}>{t('Manage publishing')}</Button>
			</section>
			<section className="es-settings-section">
				<div className="es-settings-heading"><SparkleIcon size={22} /><h2>{t('Design and content')}</h2></div>
				<p>{t('Update your products, pages, and store design in the builder. Review a draft before publishing.')}</p>
				<Link className="es-button w-fit" to={`/chat/${encodeURIComponent(app.id)}`}>{t('Open store builder')}<ArrowUpRightIcon size={16} /></Link>
			</section>
			<section className="es-settings-section">
				<div className="es-settings-heading"><StarIcon size={22} /><h2>{t('Keep this store close')}</h2></div>
				<p>{t('Pin this store to your favorites for quick access from your workspace.')}</p>
				<Button className="w-fit" disabled={favorite.isPending} onClick={() => favorite.mutate(app.id)}>{app.userFavorited ? t('Remove from favorites') : t('Add to favorites')}</Button>
				{favorite.error && <p role="alert" className="text-kumo-danger">{favorite.error.message}</p>}
			</section>
			<section className="es-settings-section">
				<h2>{t('Store actions')}</h2>
				<p>{t('Deleting a store is permanent. Review the confirmation before continuing.')}</p>
				<div className="w-fit"><AppActionsDropdown appId={app.id} appTitle={app.title || t('Untitled store')} onAppDeleted={() => navigate('/apps')} /></div>
			</section>
			<GoLiveDialog appId={app.id} open={publishingOpen} onOpenChange={setPublishingOpen} />
		</div>
	);
}
