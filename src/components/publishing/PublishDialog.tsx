import { useState } from 'react';
import { toast } from 'sonner';
import { Button, Loader } from '@cloudflare/kumo';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { usePublishSite, useSitePublishing } from '@/hooks/use-publishing';
import {
	formatTemplatePrice,
	TEMPLATE_CATEGORIES,
	TEMPLATE_CATEGORY_LABELS,
	TEMPLATE_PRICE_OPTIONS_CENTS,
	type PublishSiteRequest,
	type SitePublishingData,
	type TemplateCategory,
} from '@/api-types';

const NO_CATEGORY = 'none';

interface PublishDialogProps {
	appId: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

/** Make an app public with consent, a category and a price; change those settings; or make it private. */
export function PublishDialog({ appId, open, onOpenChange }: PublishDialogProps) {
	const publishing = useSitePublishing(appId, open);
	const publish = usePublishSite(appId);
	const data = publishing.data;
	const isPublic = data?.visibility === 'public';

	const submit = (body: PublishSiteRequest) =>
		publish.mutate(body, {
			onSuccess: (result) => {
				toast.success(result.message);
				onOpenChange(false);
			},
			onError: (error) => toast.error(error.message),
		});

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>{isPublic ? 'Publishing settings' : 'Make public'}</DialogTitle>
					<DialogDescription>
						Public sites appear in Discover, where anyone can start a new app from a copy of yours. A paid site can be
						used once an Estori admin approves its price.
					</DialogDescription>
				</DialogHeader>
				{publishing.isLoading ? (
					<div className="flex justify-center py-6">
						<Loader />
					</div>
				) : publishing.isError ? (
					<p className="text-sm text-kumo-subtle">{publishing.error.message}</p>
				) : data && !isPublic && data.ineligibleReason ? (
					<p className="text-sm text-kumo-subtle">{data.ineligibleReason}</p>
				) : data ? (
					<PublishForm data={data} pending={publish.isPending} onSubmit={submit} />
				) : null}
			</DialogContent>
		</Dialog>
	);
}

/** The price the owner last asked for, so reopening the dialog never resets a paid site to free. */
function savedPrice(data: SitePublishingData): number {
	const listing = data.listing;
	if (!listing || listing.status !== 'listed') return 0;
	return listing.versions[0]?.priceCents ?? listing.approvedPriceCents ?? 0;
}

interface PublishFormProps {
	data: SitePublishingData;
	pending: boolean;
	onSubmit: (body: PublishSiteRequest) => void;
}

/** Mounted only while the form shows, so each open starts from the saved settings. */
function PublishForm({ data, pending, onSubmit }: PublishFormProps) {
	const isPublic = data.visibility === 'public';
	const [category, setCategory] = useState<TemplateCategory | typeof NO_CATEGORY>(data.category ?? NO_CATEGORY);
	const [priceCents, setPriceCents] = useState<number>(savedPrice(data));
	// An already-public site was published with consent; changing its settings keeps it.
	const [consent, setConsent] = useState(isPublic);

	const publish = () =>
		onSubmit({
			visibility: 'public',
			reuseConsent: consent,
			category: category === NO_CATEGORY ? null : category,
			priceCents,
		});

	return (
		<div className="grid gap-4">
			{isPublic && data.ineligibleReason && <p className="text-sm text-kumo-subtle">{data.ineligibleReason}</p>}
			<div className="grid grid-cols-2 gap-3">
				<div className="grid gap-1.5">
					<span className="text-sm font-medium text-kumo-default">Category</span>
					<Select
						value={category}
						onValueChange={(value) => {
							if (value === NO_CATEGORY) {
								setCategory(NO_CATEGORY);
								return;
							}
							const match = TEMPLATE_CATEGORIES.find((candidate) => candidate === value);
							if (match) setCategory(match);
						}}
					>
						<SelectTrigger aria-label="Category">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value={NO_CATEGORY}>No category</SelectItem>
							{TEMPLATE_CATEGORIES.map((value) => (
								<SelectItem key={value} value={value}>
									{TEMPLATE_CATEGORY_LABELS[value]}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="grid gap-1.5">
					<span className="text-sm font-medium text-kumo-default">Price</span>
					<Select value={String(priceCents)} onValueChange={(value) => setPriceCents(Number(value))}>
						<SelectTrigger aria-label="Price">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{TEMPLATE_PRICE_OPTIONS_CENTS.map((value) => (
								<SelectItem key={value} value={String(value)}>
									{formatTemplatePrice(value)}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			</div>
			{priceCents > 0 && (
				<p className="text-xs text-kumo-subtle">
					An admin reviews the price before anyone can use your site. Payments are in test mode, so buyers aren't
					charged yet.
				</p>
			)}
			<label className="flex items-start gap-2 text-sm text-kumo-default">
				<Checkbox checked={consent} onCheckedChange={(checked) => setConsent(checked === true)} />
				<span>Others may copy and adapt this site.</span>
			</label>
			<div className="flex justify-end gap-2">
				{isPublic && (
					<Button variant="secondary" disabled={pending} onClick={() => onSubmit({ visibility: 'private' })}>
						Make private
					</Button>
				)}
				<Button variant="primary" loading={pending} disabled={!consent} onClick={publish}>
					{isPublic ? 'Save' : 'Publish'}
				</Button>
			</div>
		</div>
	);
}
