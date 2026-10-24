import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Badge, Button, Empty, InputArea, Loader } from '@cloudflare/kumo';
import { t, useI18n } from '@/lib/i18n';
import { AdminPage, AdminPanel, AdminTablePanel, Table } from './admin-layout';
import { PageCopySections } from '@/components/site-page/PageCopySections';
import {
	usePendingReviews,
	useRefreshShowcaseScreenshots,
	useReviewVersion,
	useReviewVersionFile,
	useReviewVersionFiles,
} from '@/hooks/use-publishing';
import { useAdminSales } from '@/hooks/use-payments';
import { formatFileSize, formatMoney } from '@/lib/paid-listing-display';
import { showcaseRefreshMessage } from '@/lib/showcase-refresh-message';
import { SHOWCASE_MOVING_MIN } from '@/lib/showcase';
import { useShowcaseStores } from '@/hooks/use-showcase-stores';
import { formatTemplatePrice, type PendingReview } from '@/api-types';
import { isForbiddenError } from '@/lib/security-error';

export default function AdminReviewsPage() {
	useI18n();
	const pending = usePendingReviews();

	return (
		<AdminPage
			section="reviews"
			title={t('Reviews')}
			description={t(
				'Approve prices for paid sites. A rejection needs a reason the creator will see. To take a site out of Discover, open it and use Remove from Discover.',
			)}
			refreshing={pending.isFetching}
			onRefresh={() => void pending.refetch()}
		>
			{pending.data ? (
				<>
					{pending.isError && (
						<p className="text-sm text-kumo-danger">{`Couldn't refresh the queue: ${pending.error.message}`}</p>
					)}
					{pending.data.reviews.length > 0 ? (
						pending.data.reviews.map((review) => (
							<PendingReviewCard
								key={review.versionId}
								review={review}
							/>
						))
					) : (
						<Empty
							title={t('Nothing to review')}
							description={t(
								'New paid sites and updates will show up here.',
							)}
						/>
					)}
					<ShowcaseImagesSection />
					<SalesSection />
				</>
			) : pending.isLoading ? (
				<div className="flex justify-center py-16">
					<Loader />
				</div>
			) : isForbiddenError(pending.error) ? (
				<Empty
					title={t('Admins only')}
					description={pending.error?.message}
				/>
			) : (
				<Empty
					title={t("Couldn't load the review queue")}
					description={pending.error?.message}
					contents={
						<Button
							size="sm"
							variant="secondary"
							onClick={() => pending.refetch()}
						>
							{t('Try again')}
						</Button>
					}
				/>
			)}
		</AdminPage>
	);
}

/** Captures the tall Discover showcase images that stores are still missing, a batch per click. */
/** How many stores are showcased, and what the landing page shows for that many. */
function ShowcasedCount() {
	const showcased = useShowcaseStores();
	if (!showcased.data) return null;
	const count = showcased.data.length;
	return (
		<p className="text-sm text-kumo-default">
			{count === 1 ? '1 store is' : `${count} stores are`} showcased on
			the landing page.{' '}
			{count < SHOWCASE_MOVING_MIN
				? `It shows them as one still row until ${SHOWCASE_MOVING_MIN} are showcased, then as two moving rows.`
				: 'It shows them as two moving rows.'}{' '}
			To add or remove a store, open it and use Show on the landing page.
		</p>
	);
}

function ShowcaseImagesSection() {
	const refresh = useRefreshShowcaseScreenshots();
	return (
		<AdminPanel title={t('Landing page showcase')}>
			<div className="grid gap-1">
				<ShowcasedCount />
				<p className="text-sm text-kumo-subtle">
					The landing page shows a tall image of each Discover store.
					Stores get one when they're published or redeployed; this
					captures the ones still missing.
				</p>
			</div>
			<div className="flex flex-wrap items-center gap-3">
				<Button
					size="sm"
					variant="secondary"
					disabled={refresh.isPending}
					onClick={() => refresh.mutate()}
				>
					{refresh.isPending
						? t('Capturing…')
						: t('Refresh showcase images')}
				</Button>
				{refresh.data && (
					<p className="text-sm text-kumo-subtle">
						{showcaseRefreshMessage(refresh.data)}
					</p>
				)}
				{refresh.isError && (
					<p className="text-sm text-kumo-danger">
						{refresh.error.message}
					</p>
				)}
			</div>
		</AdminPanel>
	);
}

/** The latest Stripe sales and Estori's total fees. */
function SalesSection() {
	const sales = useAdminSales();
	if (sales.isLoading) return <Loader />;
	if (sales.isError) {
		return (
			<p className="pt-4 text-sm text-kumo-subtle">{`Couldn't load sales: ${sales.error.message}`}</p>
		);
	}
	if (!sales.data) return null;
	const { sales: rows, totalFeesCents } = sales.data;
	return (
		<AdminTablePanel
			title={t('Sales')}
			count={rows.length}
			actions={
				<span className="text-xs text-kumo-subtle">
					{t('Estori fees so far: {amount}', {
						amount: formatMoney(totalFeesCents),
					})}
				</span>
			}
		>
			{rows.length === 0 ? (
				<Empty
					size="sm"
					title={t('No sales yet')}
					description={t(
						'Paid sites bought through Stripe show up here.',
					)}
				/>
			) : (
				<Table>
					<Table.Header>
						<Table.Row>
							<th>{t('Site')}</th>
							<th>{t('Buyer')}</th>
							<th>{t('Price')}</th>
							<th>{t('Platform fee')}</th>
							<th>{t('Sold')}</th>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{rows.map((sale) => (
							<Table.Row key={sale.purchaseId}>
								<Table.Cell>
									{sale.appId && sale.appTitle ? (
										<Link
											to={`/app/${sale.appId}`}
											className="underline underline-offset-2"
										>
											{sale.appTitle}
										</Link>
									) : (
										t('Deleted site')
									)}
								</Table.Cell>
								<Table.Cell>
									{sale.buyerEmail ?? t('Unknown buyer')}
								</Table.Cell>
								<Table.Cell>
									{formatMoney(sale.priceCents)}
								</Table.Cell>
								<Table.Cell>
									{formatMoney(sale.platformFeeCents)}
								</Table.Cell>
								<Table.Cell>
									{sale.soldAt
										? new Date(sale.soldAt).toLocaleString()
										: '—'}
								</Table.Cell>
							</Table.Row>
						))}
					</Table.Body>
				</Table>
			)}
		</AdminTablePanel>
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
		<AdminPanel
			title={label}
			actions={
				<Badge variant="info">
					{formatTemplatePrice(review.priceCents)}
				</Badge>
			}
		>
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
						{review.fileCount} files ·{' '}
						{formatFileSize(review.totalBytes)}
					</p>
					<p className="text-kumo-subtle">
						By {review.creatorName}
						{review.creatorEmail ? ` (${review.creatorEmail})` : ''}
						{review.submittedAt
							? ` · submitted ${new Date(review.submittedAt).toLocaleString()}`
							: ''}
					</p>
					<Link
						to={`/app/${review.appId}`}
						className="w-fit text-kumo-default underline-offset-2 hover:underline"
					>
						{t('Open the site')}
					</Link>
				</div>
				<div className="grid gap-2 rounded-lg p-3 ring ring-kumo-hairline">
					<span className="text-xs font-medium uppercase tracking-wide text-kumo-subtle">
						{t('Page text')}
					</span>
					{review.pageCopy ? (
						<>
							<p className="text-sm font-medium text-kumo-default">
								{review.pageCopy.tagline}
							</p>
							<PageCopySections
								copy={review.pageCopy}
								fallbackDescription={null}
							/>
						</>
					) : (
						<p className="text-sm text-kumo-subtle">
							{t('No page text')}
						</p>
					)}
				</div>
				<div className="grid gap-2">
					<Button
						size="sm"
						variant="ghost"
						className="w-fit"
						onClick={() => setShowFiles((open) => !open)}
					>
						{showFiles ? t('Hide files') : t('Show files')}
					</Button>
					{showFiles && (
						<SnapshotFiles versionId={review.versionId} />
					)}
				</div>
				{rejecting ? (
					<div className="grid gap-2">
						<InputArea
							id={`reject-${review.versionId}`}
							label={t('Reason for the creator')}
							value={reason}
							maxLength={500}
							onChange={(event) => setReason(event.target.value)}
						/>
						<div className="flex justify-end gap-2">
							<Button
								size="sm"
								variant="ghost"
								onClick={() => setRejecting(false)}
							>
								{t('Cancel')}
							</Button>
							<Button
								size="sm"
								variant="destructive"
								loading={decide.isPending}
								disabled={!reason.trim()}
								onClick={reject}
							>
								{t('Reject')}
							</Button>
						</div>
					</div>
				) : (
					<div className="flex justify-end gap-2">
						<Button
							size="sm"
							variant="secondary-destructive"
							onClick={() => setRejecting(true)}
						>
							{t('Reject')}
						</Button>
						<Button
							size="sm"
							variant="primary"
							loading={decide.isPending}
							onClick={approve}
						>
							{t('Approve')}
						</Button>
					</div>
				)}
			</div>
		</AdminPanel>
	);
}

/** The frozen files of a version, with a read-only viewer for one file. */
function SnapshotFiles({ versionId }: { versionId: string }) {
	const files = useReviewVersionFiles(versionId);
	const [selected, setSelected] = useState<string | null>(null);
	const file = useReviewVersionFile(versionId, selected);

	if (files.isLoading) return <Loader />;
	if (files.isError)
		return (
			<p className="text-sm text-kumo-subtle">{files.error.message}</p>
		);

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
							<span className="truncate font-mono text-xs">
								{entry.path}
							</span>
							<span className="shrink-0 text-xs text-kumo-subtle">
								{formatFileSize(entry.bytes)}
							</span>
						</button>
					</li>
				))}
			</ul>
			<div className="max-h-80 overflow-auto rounded-lg ring ring-kumo-hairline">
				{!selected ? (
					<p className="p-3 text-sm text-kumo-subtle">
						{t('Choose a file to read it.')}
					</p>
				) : file.isLoading ? (
					<div className="p-3">
						<Loader />
					</div>
				) : file.isError ? (
					<p className="p-3 text-sm text-kumo-subtle">
						{file.error.message}
					</p>
				) : file.data?.binary ? (
					<p className="p-3 text-sm text-kumo-subtle">
						Binary file ({formatFileSize(file.data.bytes)})
					</p>
				) : (
					<pre className="whitespace-pre-wrap break-words p-3 font-mono text-xs">
						{file.data?.content}
					</pre>
				)}
			</div>
		</div>
	);
}
