import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Badge, Button, Empty, InputArea, LayerCard, Loader } from '@cloudflare/kumo';
import { pageTitle } from '@/brand';
import {
	usePendingTemplateVersions,
	useReviewTemplateVersion,
	useSetTemplateListing,
	useTemplateGallery,
	useTemplateVersionFile,
	useTemplateVersionFiles,
} from '@/hooks/use-templates';
import { formatFileSize } from '@/lib/template-display';
import {
	formatTemplatePrice,
	SecurityError,
	SecurityErrorType,
	TEMPLATE_CATEGORY_LABELS,
	type PendingTemplateVersion,
	type PublicTemplateCard,
} from '@/api-types';

function isForbidden(error: unknown): boolean {
	return error instanceof SecurityError && error.type === SecurityErrorType.FORBIDDEN;
}

export default function AdminTemplatesPage() {
	const pending = usePendingTemplateVersions();

	return (
		<div className="size-full">
			<title>{pageTitle('Template review')}</title>
			<div className="container max-w-5xl mx-auto px-4 py-8 grid gap-6">
				<div className="grid gap-1">
					<h1 className="text-3xl font-semibold text-kumo-strong">Template review</h1>
					<p className="text-kumo-subtle">
						Approve templates that belong in the gallery. A rejection needs a reason the creator will see.
					</p>
				</div>
				{pending.data ? (
					<>
						{pending.isError && (
							<p className="text-sm text-kumo-danger">{`Couldn't refresh the queue: ${pending.error.message}`}</p>
						)}
						{pending.data.versions.length > 0 ? (
							pending.data.versions.map((version) => (
								<PendingVersionCard key={version.versionId} version={version} />
							))
						) : (
							<Empty title="Nothing to review" description="New submissions will show up here." />
						)}
						<PublishedTemplates />
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

function PendingVersionCard({ version }: { version: PendingTemplateVersion }) {
	const review = useReviewTemplateVersion();
	const [showFiles, setShowFiles] = useState(false);
	const [rejecting, setRejecting] = useState(false);
	const [reason, setReason] = useState('');
	const label = `${version.templateName} v${version.version}`;

	const approve = () =>
		review.mutate(
			{ versionId: version.versionId, decision: 'approve' },
			{
				onSuccess: () => toast.success(`${label} is published`),
				onError: (error) => toast.error(error.message),
			},
		);

	const reject = () =>
		review.mutate(
			{ versionId: version.versionId, decision: 'reject', reason },
			{
				onSuccess: () => toast.success(`${label} was rejected`),
				onError: (error) => toast.error(error.message),
			},
		);

	return (
		<LayerCard>
			<LayerCard.Secondary className="flex flex-wrap items-center justify-between gap-2">
				<span className="font-medium">{label}</span>
				<Badge variant={version.priceCents > 0 ? 'info' : 'success'}>{formatTemplatePrice(version.priceCents)}</Badge>
			</LayerCard.Secondary>
			<LayerCard.Primary>
				<div className="grid gap-4">
					<div className="grid gap-4 md:grid-cols-[1fr_160px]">
						<img
							src={version.desktopShotUrl}
							alt={`${version.templateName} on a desktop`}
							className="w-full rounded-lg ring ring-kumo-hairline"
						/>
						<img
							src={version.mobileShotUrl}
							alt={`${version.templateName} on a phone`}
							className="w-full rounded-lg ring ring-kumo-hairline"
						/>
					</div>
					<div className="grid gap-1 text-sm">
						<p className="text-kumo-default">{version.description}</p>
						<p className="text-kumo-subtle">
							{TEMPLATE_CATEGORY_LABELS[version.category]} · {version.fileCount} files ·{' '}
							{formatFileSize(version.totalBytes)}
						</p>
						<p className="text-kumo-subtle">
							By {version.creatorName}
							{version.creatorEmail ? ` (${version.creatorEmail})` : ''}
							{version.submittedAt ? ` · submitted ${new Date(version.submittedAt).toLocaleString()}` : ''}
						</p>
						{version.sourceAppId && (
							<Link
								to={`/app/${version.sourceAppId}`}
								className="w-fit text-kumo-default underline-offset-2 hover:underline"
							>
								Open the source app
							</Link>
						)}
					</div>
					<div className="grid gap-2">
						<Button size="sm" variant="ghost" className="w-fit" onClick={() => setShowFiles((open) => !open)}>
							{showFiles ? 'Hide files' : 'Show files'}
						</Button>
						{showFiles && <SnapshotFiles versionId={version.versionId} />}
					</div>
					{rejecting ? (
						<div className="grid gap-2">
							<InputArea
								id={`reject-${version.versionId}`}
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
									loading={review.isPending}
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
							<Button size="sm" variant="primary" loading={review.isPending} onClick={approve}>
								Approve
							</Button>
						</div>
					)}
				</div>
			</LayerCard.Primary>
		</LayerCard>
	);
}

/** The templates in the gallery, so an admin can take one out of it. */
function PublishedTemplates() {
	const gallery = useTemplateGallery({ category: null, search: '', limit: 24 });
	const templates = gallery.data?.pages.flatMap((page) => page.templates) ?? [];

	return (
		<section className="grid gap-3 pt-4">
			<div className="grid gap-1">
				<h2 className="text-xl font-semibold text-kumo-strong">Published templates</h2>
				<p className="text-sm text-kumo-subtle">Unlisting takes a template out of the gallery.</p>
			</div>
			{gallery.isLoading ? (
				<div className="flex justify-center py-8">
					<Loader />
				</div>
			) : gallery.isError ? (
				<Empty size="sm" title="Published templates didn't load" description={gallery.error.message} />
			) : templates.length === 0 ? (
				<Empty size="sm" title="No published templates" description="Approved templates will show up here." />
			) : (
				templates.map((template) => <PublishedTemplateRow key={template.id} template={template} />)
			)}
			{gallery.hasNextPage && (
				<Button
					size="sm"
					variant="secondary"
					className="w-fit justify-self-center"
					loading={gallery.isFetchingNextPage}
					onClick={() => void gallery.fetchNextPage()}
				>
					Load more
				</Button>
			)}
		</section>
	);
}

function PublishedTemplateRow({ template }: { template: PublicTemplateCard }) {
	const listing = useSetTemplateListing();

	const unlist = () =>
		listing.mutate(
			{ templateId: template.id, listed: false },
			{
				onSuccess: () => toast.success(`${template.name} is unlisted`),
				onError: (error) => toast.error(error.message),
			},
		);

	return (
		<div className="flex flex-wrap items-center justify-between gap-3 rounded-lg px-3 py-3 ring ring-kumo-hairline">
			<div className="grid min-w-0 gap-0.5">
				<Link
					to={`/templates/${template.slug}`}
					className="truncate text-sm font-medium text-kumo-default underline-offset-2 hover:underline"
				>
					{template.name}
				</Link>
				<p className="text-sm text-kumo-subtle">
					By {template.creatorName} · {formatTemplatePrice(template.priceCents)} · {template.useCount} uses
				</p>
			</div>
			<Button size="sm" variant="secondary-destructive" loading={listing.isPending} onClick={unlist}>
				Unlist
			</Button>
		</div>
	);
}

/** The frozen files of a version, with a read-only viewer for one file. */
function SnapshotFiles({ versionId }: { versionId: string }) {
	const files = useTemplateVersionFiles(versionId);
	const [selected, setSelected] = useState<string | null>(null);
	const file = useTemplateVersionFile(versionId, selected);

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
