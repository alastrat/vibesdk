import { Link } from 'react-router';
import { toast } from 'sonner';
import { Badge, Button, Empty, Loader } from '@cloudflare/kumo';
import { useMyPaidListings, useWithdrawPaidVersion } from '@/hooks/use-publishing';
import { paidListingStatusView } from '@/lib/paid-listing-display';
import type { MyPaidListing } from '@/api-types';

/** The profile's list of the owner's paid sites, with review status and buyers. */
export function PaidListingsList() {
	const listings = useMyPaidListings();
	if (listings.isLoading) return <Loader />;
	if (listings.isError) return <p className="text-sm text-kumo-subtle">{listings.error.message}</p>;
	const rows = listings.data?.listings ?? [];
	if (rows.length === 0) {
		return (
			<Empty
				size="sm"
				title="No paid sites yet"
				description="Set a price when you make a site public, and it shows up here."
			/>
		);
	}
	return (
		<div className="grid gap-2">
			{rows.map((listing) => (
				<PaidListingRow key={listing.id} listing={listing} />
			))}
		</div>
	);
}

function PaidListingRow({ listing }: { listing: MyPaidListing }) {
	const withdraw = useWithdrawPaidVersion(listing.appId);
	const view = paidListingStatusView(listing);
	const pendingVersionId = view?.pendingVersionId ?? null;

	return (
		<div className="flex flex-wrap items-center justify-between gap-3 rounded-lg px-3 py-3 ring ring-kumo-hairline">
			<div className="grid min-w-0 gap-0.5">
				<Link
					to={`/app/${listing.appId}`}
					className="truncate text-sm font-medium text-kumo-default underline-offset-2 hover:underline"
				>
					{listing.appTitle}
				</Link>
				<p className="text-sm text-kumo-subtle">
					{listing.buyerCount} {listing.buyerCount === 1 ? 'buyer' : 'buyers'}
					{view?.detail ? ` · ${view.detail}` : ''}
				</p>
			</div>
			<div className="flex items-center gap-2">
				<Badge variant={view?.variant ?? 'secondary'}>{view?.label ?? 'Free'}</Badge>
				{pendingVersionId && (
					<Button
						size="sm"
						variant="secondary"
						loading={withdraw.isPending}
						onClick={() =>
							withdraw.mutate(pendingVersionId, {
								onSuccess: () => toast.success('The version was withdrawn'),
								onError: (error) => toast.error(error.message),
							})
						}
					>
						Withdraw
					</Button>
				)}
			</div>
		</div>
	);
}
