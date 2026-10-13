import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@cloudflare/kumo';
import { useAuth } from '@/contexts/auth-context';
import { usePurchaseSite } from '@/hooks/use-publishing';
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
	const purchase = usePurchaseSite();
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

	if (!reuse || (!reuse.canUse && !reuse.needsPurchase)) return null;

	if (reuse.needsPurchase && reuse.priceCents !== null) {
		const price = formatTemplatePrice(reuse.priceCents);
		const buy = () => {
			if (!requireAuth({ requireFullAuth: true, actionContext: 'to buy this site', intendedUrl })) return;
			purchase.mutate(app.id, {
				onSuccess: () => toast.success(`You bought ${app.title}. You can use it now.`),
				onError: (error) => toast.error(error.message),
			});
		};
		return (
			<div className="flex items-center gap-2">
				<span className="text-xs text-kumo-subtle">Payments are in test mode. You won't be charged.</span>
				<Button size="sm" variant="primary" loading={purchase.isPending} onClick={buy}>
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
