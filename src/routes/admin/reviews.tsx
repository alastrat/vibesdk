import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Badge, Button, Empty, InputArea, LayerCard, Loader } from '@cloudflare/kumo';
import { pageTitle } from '@/brand';
import { usePendingReviews, useReviewVersion, useReviewVersionFile, useReviewVersionFiles } from '@/hooks/use-publishing';
import { formatFileSize } from '@/lib/paid-listing-display';
import { formatTemplatePrice, SecurityError, SecurityErrorType, type PendingReview } from '@/api-types';

function isForbidden(error: unknown): boolean {
	return error instanceof SecurityError && error.type === SecurityErrorType.FORBIDDEN;
}

export default function AdminReviewsPage() {
	const pending = usePendingReviews();

	return (
		<div className="size-full">
			<title>{pageTitle('Reviews')}</title>
			<div className="container max-w-5xl mx-auto px-4 py-8 grid gap-6">
				<div className="grid gap-1">
					<h1 className="text-3xl font-semibold text-kumo-strong">Reviews</h1>
					<p className="text-kumo-subtle">
						Approve prices for paid sites. A rejection needs a reason the creator will see. To take a site out of
						Discover, open it and use Remove from Discover.
					</p>
				</div>
				{pending.data ? (
					<>
						{pending.isError && (
							<p className="text-sm text-kumo-danger">{`Couldn't refresh the queue: ${pending.error.message}`}</p>
						)}
						{pending.data.reviews.length > 0 ? (
							pending.data.reviews.map((review) => <PendingReviewCard key={review.versionId} review={review} />)
						) : (
							<Empty title="Nothing to review" description="New paid sites and updates will show up here." />
						)}
					</>
				) : pending.isLoading ? (
					<div className="flex justify-center py-16">
						<Loader />
					</div>
				) : isForbidden(pending.error) ? (
					<Empty title="Admins only" description={pending.error?.message} />
				) : (
					<Empty
						title="Couldn't load the review queue"
						description={pending.error?.message}
						contents={
							<Button size="sm" variant="secondary" onClick={() => pending.refetch()}>
								Try again
							</Button>
						}
					/>
				)}
			</div>
		</div>
	);
}

function PendingReviewCard({ review }: { review: PendingReview }) {
	const decide = useReviewVersion();
	const [showFiles, setShowFiles] = useState(false);
	const [rejecting, setRejecting] = useState(false);
	const [reason, setReason] = useState('');
	const label = `${review.appTitle} v${review.version}`;

	const approve = () =>
		decide.mutate(
			{ versionId: review.versionId, decision: 'approve' },
			{
				onSuccess: () => toast.success(`${label} is approved`),
				onError: (error) => toast.error(error.message),
			},
		);

	const reject = () =>
		decide.mutate(
			{ versionId: review.versionId, decision: 'reject', reason },
			{
				onSuccess: () => toast.success(`${label} was rejected`),
				onError: (error) => toast.error(error.message),
			},
		);

	return (
		<LayerCard>
			<LayerCard.Secondary className="flex flex-wrap items-center justify-between gap-2">
				<span className="font-medium">{label}</span>
				<Badge variant="info">{formatTemplatePrice(review.priceCents)}</Badge>
			</LayerCard.Secondary>
			<LayerCard.Primary>
				<div className="grid gap-4">
					<div className="grid gap-4 md:grid-cols-[1fr_160px]">
						<img
							src={review.desktopShotUrl}
							alt={`${review.appTitle} on a desktop`}
							className="w-full rounded-lg ring ring-kumo-hairline"
						/>
						<img
							src={review.mobileShotUrl}
							alt={`${review.appTitle} on a phone`}
							className="w-full rounded-lg ring ring-kumo-hairline"
						/>
					</div>
					<div className="grid gap-1 text-sm">
						<p className="text-kumo-subtle">
							{review.fileCount} files · {formatFileSize(review.totalBytes)}
						</p>
						<p className="text-kumo-subtle">
							By {review.creatorName}
							{review.creatorEmail ? ` (${review.creatorEmail})` : ''}
							{review.submittedAt ? ` · submitted ${new Date(review.submittedAt).toLocaleString()}` : ''}
						</p>
						<Link to={`/app/${review.appId}`} className="w-fit text-kumo-default underline-offset-2 hover:underline">
							Open the site
						</Link>
					</div>
					<div className="grid gap-2">
						<Button size="sm" variant="ghost" className="w-fit" onClick={() => setShowFiles((open) => !open)}>
							{showFiles ? 'Hide files' : 'Show files'}
						</Button>
						{showFiles && <SnapshotFiles versionId={review.versionId} />}
					</div>
					{rejecting ? (
						<div className="grid gap-2">
							<InputArea
								id={`reject-${review.versionId}`}
								label="Reason for the creator"
								value={reason}
								maxLength={500}
								onChange={(event) => setReason(event.target.value)}
							/>
							<div className="flex justify-end gap-2">
								<Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>
									Cancel
								</Button>
								<Button
									size="sm"
									variant="destructive"
									loading={decide.isPending}
									disabled={!reason.trim()}
									onClick={reject}
								>
									Reject
								</Button>
							</div>
						</div>
					) : (
						<div className="flex justify-end gap-2">
							<Button size="sm" variant="secondary-destructive" onClick={() => setRejecting(true)}>
								Reject
							</Button>
							<Button size="sm" variant="primary" loading={decide.isPending} onClick={approve}>
								Approve
							</Button>
						</div>
					)}
				</div>
			</LayerCard.Primary>
		</LayerCard>
	);
}

/** The frozen files of a version, with a read-only viewer for one file. */
function SnapshotFiles({ versionId }: { versionId: string }) {
	const files = useReviewVersionFiles(versionId);
	const [selected, setSelected] = useState<string | null>(null);
	const file = useReviewVersionFile(versionId, selected);

	if (files.isLoading) return <Loader />;
	if (files.isError) return <p className="text-sm text-kumo-subtle">{files.error.message}</p>;

	return (
		<div className="grid gap-3 md:grid-cols-[260px_1fr]">
			<ul className="max-h-80 overflow-auto rounded-lg text-sm ring ring-kumo-hairline">
				{files.data?.files.map((entry) => (
					<li key={entry.path}>
						<button
							type="button"
							onClick={() => setSelected(entry.path)}
							className="flex w-full justify-between gap-2 px-3 py-1.5 text-left hover:bg-kumo-elevated"
						>
							<span className="truncate font-mono text-xs">{entry.path}</span>
							<span className="shrink-0 text-xs text-kumo-subtle">{formatFileSize(entry.bytes)}</span>
						</button>
					</li>
				))}
			</ul>
			<div className="max-h-80 overflow-auto rounded-lg ring ring-kumo-hairline">
				{!selected ? (
					<p className="p-3 text-sm text-kumo-subtle">Choose a file to read it.</p>
				) : file.isLoading ? (
					<div className="p-3">
						<Loader />
					</div>
				) : file.isError ? (
					<p className="p-3 text-sm text-kumo-subtle">{file.error.message}</p>
				) : file.data?.binary ? (
					<p className="p-3 text-sm text-kumo-subtle">Binary file ({formatFileSize(file.data.bytes)})</p>
				) : (
					<pre className="whitespace-pre-wrap break-words p-3 font-mono text-xs">{file.data?.content}</pre>
				)}
			</div>
		</div>
	);
}
