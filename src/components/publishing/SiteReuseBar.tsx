import { t, useI18n } from '@/lib/i18n';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge, Button, InputArea } from '@cloudflare/kumo';
import {
	useSetDiscoverRemoval,
	useSetShowcased,
	useSitePublishing,
	useSubmitPaidUpdate,
	useWithdrawPaidVersion,
} from '@/hooks/use-publishing';
import { paidListingStatusView } from '@/lib/paid-listing-display';
import type { AppDetailsData } from '@/api-types';
import { StartedFromLine } from './StartedFromLine';

interface SiteReuseBarProps {
	app: Pick<AppDetailsData, 'id' | 'visibility' | 'startedFrom' | 'canModerate' | 'removedFromDiscover' | 'isFeatured'>;
	isOwner: boolean;
}

/** The app page strip: where the app came from, the owner's paid listing, and admin moderation. */
export function SiteReuseBar({ app, isOwner }: SiteReuseBarProps) {
	useI18n();
	const isPublic = app.visibility === 'public';
	const showOwner = isOwner && isPublic;
	const showModeration = app.canModerate && isPublic;
	if (!app.startedFrom && !showOwner && !showModeration && !app.removedFromDiscover) return null;

	return (
		<div className="shrink-0 flex flex-wrap items-center justify-between gap-2 border-b bg-kumo-base px-4 py-2">
			{app.startedFrom ? <StartedFromLine startedFrom={app.startedFrom} /> : <span />}
			<div className="flex flex-wrap items-center gap-2">
				{app.removedFromDiscover && (
					<span className="text-sm text-kumo-danger">{t("Removed from Discover by an admin")}{app.removedFromDiscover.reason ? `: ${app.removedFromDiscover.reason}` : ''}
					</span>
				)}
				{showOwner && <OwnerPaidListing appId={app.id} />}
				{showModeration && app.visibility === 'public' && !app.removedFromDiscover && (
					<ShowcaseSwitch appId={app.id} showcased={app.isFeatured === true} />
				)}
				{showModeration && <DiscoverModeration appId={app.id} removed={app.removedFromDiscover !== null} />}
			</div>
		</div>
	);
}

function OwnerPaidListing({ appId }: { appId: string }) {
	useI18n();
	const publishing = useSitePublishing(appId, true);
	const submitUpdate = useSubmitPaidUpdate(appId);
	const withdraw = useWithdrawPaidVersion(appId);
	const listing = publishing.data?.listing ?? null;
	const view = listing ? paidListingStatusView(listing) : null;
	if (!listing || !view) return null;

	const pendingVersionId = view.pendingVersionId;
	const canSendUpdate = listing.approvedPriceCents !== null && pendingVersionId === null;

	return (
		<>
			<Badge variant={view.variant}>{view.label}</Badge>
			{view.detail && <span className="text-sm text-kumo-subtle">{view.detail}</span>}
			{pendingVersionId && (
				<Button
					size="sm"
					variant="secondary"
					loading={withdraw.isPending}
					onClick={() =>
						withdraw.mutate(pendingVersionId, {
							onSuccess: () => toast.success(t("The version was withdrawn")),
							onError: (error) => toast.error(error.message),
						})
					}
				>{t("Withdraw")}</Button>
			)}
			{canSendUpdate && (
				<Button
					size="sm"
					variant="secondary"
					loading={submitUpdate.isPending}
					onClick={() =>
						submitUpdate.mutate(undefined, {
							onSuccess: () => toast.success(t("Your latest deploy was sent for review")),
							onError: (error) => toast.error(error.message),
						})
					}
				>{t("Send update for review")}</Button>
			)}
		</>
	);
}

/** Admins only: put a public Discover store in the landing page's showcase, or take it out. */
function ShowcaseSwitch({ appId, showcased }: { appId: string; showcased: boolean }) {
	useI18n();
	const change = useSetShowcased();
	return (
		<Button
			size="sm"
			variant="secondary"
			loading={change.isPending}
			onClick={() =>
				change.mutate(
					{ appId, showcased: !showcased },
					{
						onSuccess: () => toast.success(showcased ? t("Removed from the landing page") : t("Shown on the landing page")),
						onError: (error) => toast.error(error.message),
					},
				)
			}
		>
			{showcased ? t("Remove from the landing page") : t("Show on the landing page")}
		</Button>
	);
}

function DiscoverModeration({ appId, removed }: { appId: string; removed: boolean }) {
	useI18n();
	const removal = useSetDiscoverRemoval();
	const [open, setOpen] = useState(false);
	const [reason, setReason] = useState('');

	if (removed) {
		return (
			<Button
				size="sm"
				variant="secondary"
				loading={removal.isPending}
				onClick={() =>
					removal.mutate(
						{ appId, body: { removed: false } },
						{
							onSuccess: () => toast.success(t("Restored to Discover")),
							onError: (error) => toast.error(error.message),
						},
					)
				}
			>{t("Restore to Discover")}</Button>
		);
	}
	if (!open) {
		return (
			<Button size="sm" variant="secondary-destructive" onClick={() => setOpen(true)}>{t("Remove from Discover")}</Button>
		);
	}
	return (
		<div className="flex flex-wrap items-end gap-2">
			<InputArea
				id={`discover-removal-${appId}`}
				label={t("Reason the owner will see")}
				value={reason}
				maxLength={500}
				onChange={(event) => setReason(event.target.value)}
			/>
			<Button size="sm" variant="ghost" onClick={() => setOpen(false)}>{t("Cancel")}</Button>
			<Button
				size="sm"
				variant="destructive"
				disabled={!reason.trim()}
				loading={removal.isPending}
				onClick={() =>
					removal.mutate(
						{ appId, body: { removed: true, reason } },
						{
							onSuccess: () => {
								toast.success(t("Removed from Discover"));
								setOpen(false);
							},
							onError: (error) => toast.error(error.message),
						},
					)
				}
			>{t("Remove")}</Button>
		</div>
	);
}
