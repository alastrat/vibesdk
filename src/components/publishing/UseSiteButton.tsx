import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@cloudflare/kumo';
import { useAuth } from '@/contexts/auth-context';
import { useConfirmSitePurchase, useCreateSiteCheckout } from '@/hooks/use-payments';
import { useAuthGuard } from '@/hooks/useAuthGuard';
import { formatTemplatePrice, type AppDetailsData } from '@/api-types';
import { UseSiteDialog } from './UseSiteDialog';

interface UseSiteButtonProps {
	app: Pick<AppDetailsData, 'id' | 'title' | 'reuse'>;
	/** Open the dialog on mount, for links from Discover (`?use=1`). */
	autoOpen?: boolean;
}

/** "Use this site", or "Buy for $X" first on a paid site the viewer doesn't own. */
export function UseSiteButton({ app, autoOpen = false }: UseSiteButtonProps) {
	const reuse = app.reuse;
	const checkout = useCreateSiteCheckout();
	const confirm = useConfirmSitePurchase();
	const [searchParams, setSearchParams] = useSearchParams();
	const confirmedSession = useRef<string | null>(null);
	const { isLoading: authLoading } = useAuth();
	const { requireAuth } = useAuthGuard();
	const [open, setOpen] = useState(false);
	const intendedUrl = `/app/${app.id}?use=1`;

	const startUse = () => {
		if (!requireAuth({ requireFullAuth: true, actionContext: 'to use this site', intendedUrl })) return;
		setOpen(true);
	};

	// Wait for the session so a signed-in viewer isn't shown the sign-in prompt.
	useEffect(() => {
		if (autoOpen && reuse?.canUse && !authLoading) startUse();
		// Runs once the session and the site are ready; the dialog then owns its state.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [autoOpen, reuse?.canUse, authLoading]);

	// Back from Stripe Checkout: record the payment, then drop the query params.
	useEffect(() => {
		const sessionId = searchParams.get('session_id');
		if (searchParams.get('purchase') === 'success' && sessionId && confirmedSession.current !== sessionId) {
			confirmedSession.current = sessionId;
			confirm.mutate(
				{ appId: app.id, sessionId },
				{
					onSuccess: () => toast.success(`Payment received. You can use ${app.title} now.`),
					onError: (error) => toast.error(error.message),
					onSettled: () => {
						const next = new URLSearchParams(searchParams);
						next.delete('purchase');
						next.delete('session_id');
						setSearchParams(next, { replace: true });
					},
				},
			);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [searchParams]);

	if (!reuse || (!reuse.canUse && !reuse.needsPurchase)) return null;

	if (reuse.needsPurchase && reuse.priceCents !== null) {
		const price = formatTemplatePrice(reuse.priceCents);
		const buy = () => {
			if (!requireAuth({ requireFullAuth: true, actionContext: 'to buy this site', intendedUrl })) return;
			checkout.mutate(app.id, {
				onSuccess: (result) => window.location.assign(result.checkoutUrl),
				onError: (error) => toast.error(error.message),
			});
		};
		return (
			<div className="flex items-center gap-2">
				<span className="text-xs text-kumo-subtle">Secure checkout with Stripe</span>
				<Button size="sm" variant="primary" loading={checkout.isPending || confirm.isPending} onClick={buy}>
					Buy for {price}
				</Button>
			</div>
		);
	}

	return (
		<>
			<Button size="sm" variant="primary" onClick={startUse}>
				Use this site
			</Button>
			<UseSiteDialog sourceAppId={app.id} sourceTitle={app.title} open={open} onOpenChange={setOpen} />
		</>
	);
}
