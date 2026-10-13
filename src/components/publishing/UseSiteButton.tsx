import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '@cloudflare/kumo';
import { useAuth } from '@/contexts/auth-context';
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
	const navigate = useNavigate();
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
		// The product page describes the site before Stripe Checkout.
		return (
			<Button size="sm" variant="primary" onClick={() => navigate(`/discover/${app.id}`)}>
				Buy for {price}
			</Button>
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
