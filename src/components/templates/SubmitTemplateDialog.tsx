import { useState } from 'react';
import { toast } from 'sonner';
import { Button, Input, InputArea, Loader } from '@cloudflare/kumo';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAppTemplate, useSubmitTemplate } from '@/hooks/use-templates';
import { templateStatusView } from '@/lib/template-display';
import {
	formatTemplatePrice,
	TEMPLATE_CATEGORIES,
	TEMPLATE_CATEGORY_LABELS,
	TEMPLATE_PRICE_OPTIONS_CENTS,
	type CreatorTemplate,
	type SubmitTemplateRequest,
	type TemplateCategory,
} from '@/api-types';

interface SubmitTemplateDialogProps {
	appId: string;
	appTitle: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function SubmitTemplateDialog({ appId, appTitle, open, onOpenChange }: SubmitTemplateDialogProps) {
	const status = useAppTemplate(appId, open);
	const submit = useSubmitTemplate(appId);

	const existing = status.data?.template ?? null;
	const pendingDetail = existing ? templateStatusView(existing) : null;
	const inReview = Boolean(pendingDetail?.pendingVersionId);
	const nextVersion = existing ? (existing.versions[0]?.version ?? 0) + 1 : 1;

	const handleSubmit = (body: SubmitTemplateRequest) => {
		submit.mutate(body, {
			onSuccess: (data) => {
				toast.success(`Version ${data.version} was submitted for review`);
				onOpenChange(false);
			},
			onError: (error) => toast.error(error.message),
		});
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>
						{existing ? `Submit version ${nextVersion} of ${existing.name}` : 'Submit as template'}
					</DialogTitle>
					<DialogDescription>
						We freeze a copy of your last deployed version. An Estori admin reviews it before it appears in the
						template gallery.
					</DialogDescription>
				</DialogHeader>

				{status.isLoading ? (
					<div className="flex justify-center py-6">
						<Loader />
					</div>
				) : status.isError ? (
					<p className="text-sm text-kumo-subtle">{status.error.message}</p>
				) : !status.data?.eligible ? (
					<p className="text-sm text-kumo-subtle">{status.data?.reason ?? 'This app cannot be submitted yet.'}</p>
				) : inReview ? (
					<p className="text-sm text-kumo-subtle">
						{pendingDetail?.detail}. You can submit again after it is reviewed or withdrawn.
					</p>
				) : (
					<SubmitTemplateForm
						existing={existing}
						appTitle={appTitle}
						pending={submit.isPending}
						onSubmit={handleSubmit}
					/>
				)}
			</DialogContent>
		</Dialog>
	);
}

interface SubmitTemplateFormProps {
	existing: CreatorTemplate | null;
	appTitle: string;
	pending: boolean;
	onSubmit: (body: SubmitTemplateRequest) => void;
}

/** Mounted only while the form shows, so each open starts from the current title with nothing confirmed. */
function SubmitTemplateForm({ existing, appTitle, pending, onSubmit }: SubmitTemplateFormProps) {
	const [name, setName] = useState(appTitle.trim().slice(0, 60));
	const [description, setDescription] = useState('');
	const [category, setCategory] = useState<TemplateCategory>('landing');
	const [priceCents, setPriceCents] = useState<number>(0);
	const [rightsConfirmed, setRightsConfirmed] = useState(false);

	const handleSubmit = () =>
		onSubmit(existing ? { rightsConfirmed } : { name, description, category, priceCents, rightsConfirmed });

	return (
		<div className="grid gap-4">
			{!existing && (
				<>
					<Input
						id="template-name"
						label="Name"
						value={name}
						maxLength={60}
						onChange={(event) => setName(event.target.value)}
					/>
					<InputArea
						id="template-description"
						label="Short description"
						placeholder="What the site is for and what makes it good to start from"
						value={description}
						maxLength={280}
						onChange={(event) => setDescription(event.target.value)}
					/>
					<div className="grid grid-cols-2 gap-3">
						<div className="grid gap-1.5">
							<span className="text-sm font-medium text-kumo-default">Category</span>
							<Select
								value={category}
								onValueChange={(value) => {
									const match = TEMPLATE_CATEGORIES.find((candidate) => candidate === value);
									if (match) setCategory(match);
								}}
							>
								<SelectTrigger aria-label="Category">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
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
						<p className="text-xs text-kumo-subtle">Payments are in test mode. Buyers are not charged yet.</p>
					)}
					<p className="text-xs text-kumo-subtle">
						Name, description, category and price can't be changed after you submit.
					</p>
				</>
			)}
			<label className="flex items-start gap-2 text-sm text-kumo-default">
				<Checkbox checked={rightsConfirmed} onCheckedChange={(checked) => setRightsConfirmed(checked === true)} />
				<span>I own the rights to this content and allow others to copy and adapt it.</span>
			</label>
			<div className="flex justify-end">
				<Button variant="primary" loading={pending} disabled={!rightsConfirmed} onClick={handleSubmit}>
					Submit for review
				</Button>
			</div>
		</div>
	);
}
