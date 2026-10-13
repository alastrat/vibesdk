import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { Button, Loader } from '@cloudflare/kumo';
import { useSitePage } from '@/hooks/use-site-page';
import { useCreateSiteCheckout } from '@/hooks/use-payments';
import { useAuthGuard } from '@/hooks/useAuthGuard';
import { UseSiteDialog } from '@/components/publishing/UseSiteDialog';
import { PublishDialog } from '@/components/publishing/PublishDialog';
import { SiteHeader } from '@/components/site-page/SiteHeader';
import { DevicePreview } from '@/components/site-page/DevicePreview';
import { PageCopySections } from '@/components/site-page/PageCopySections';
import { SiteDetailsCard } from '@/components/site-page/SiteDetailsCard';
import { MoreFromCreator } from '@/components/site-page/MoreFromCreator';
import { StickyBuyBar } from '@/components/site-page/StickyBuyBar';
import type { SiteActions } from '@/components/site-page/SiteMainButton';
import { SITE_PAGE_UNAVAILABLE_MESSAGE } from '@/api-types';

/** A Discover site's product page: the live site, its page text and the action that fits the viewer. */
export default function SitePage() {
	const { appId } = useParams<{ appId: string }>();
	const page = useSitePage(appId);
	const checkout = useCreateSiteCheckout();
	const { requireAuth } = useAuthGuard();
	const [useOpen, setUseOpen] = useState(false);
	const [editOpen, setEditOpen] = useState(false);
	const actionsRef = useRef<HTMLDivElement>(null);

	if (page.isLoading) {
		return (
			<div className="flex justify-center py-24">
				<Loader />
			</div>
		);
	}

	if (page.isError || !page.data) {
		const unavailable = !page.error || page.error.message === SITE_PAGE_UNAVAILABLE_MESSAGE;
		return (
			<div className="mx-auto grid max-w-md justify-items-center gap-3 px-4 py-24 text-center">
				<p className="text-kumo-default">{unavailable ? SITE_PAGE_UNAVAILABLE_MESSAGE : page.error?.message}</p>
				{unavailable ? (
					<Link to="/discover" className="text-sm text-kumo-subtle underline-offset-2 hover:underline">
						Back to Discover
					</Link>
				) : (
					<Button variant="secondary" onClick={() => page.refetch()}>
						Try again
					</Button>
				)}
			</div>
		);
	}

	const data = page.data;
	const intendedUrl = `/discover/${data.id}`;
	const actions: SiteActions = {
		use: () => {
			if (requireAuth({ requireFullAuth: true, actionContext: 'to use this site', intendedUrl })) setUseOpen(true);
		},
		buy: () => {
			if (!requireAuth({ requireFullAuth: true, actionContext: 'to buy this site', intendedUrl })) return;
			checkout.mutate(data.id, {
				onSuccess: (result) => window.location.assign(result.checkoutUrl),
				onError: (error) => toast.error(error.message),
			});
		},
		edit: () => setEditOpen(true),
		buying: checkout.isPending || checkout.isSuccess,
	};

	return (
		<div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-8 pb-24">
			<SiteHeader page={data} actions={actions} actionsRef={actionsRef} />
			<DevicePreview title={data.title} previewUrl={data.previewUrl} screenshotUrl={data.screenshotUrl} />
			<div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
				<PageCopySections copy={data.copy} fallbackDescription={data.description} />
				<SiteDetailsCard page={data} />
			</div>
			<MoreFromCreator creatorName={data.creator.displayName} sites={data.moreFromCreator} />
			<StickyBuyBar page={data} actions={actions} watchRef={actionsRef} />
			<UseSiteDialog sourceAppId={data.id} sourceTitle={data.title} open={useOpen} onOpenChange={setUseOpen} />
			{data.offer.kind === 'own' && <PublishDialog appId={data.id} open={editOpen} onOpenChange={setEditOpen} />}
		</div>
	);
}
