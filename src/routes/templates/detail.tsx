import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { Badge, Button, Empty, Loader } from '@cloudflare/kumo';
import { pageTitle } from '@/brand';
import { UseTemplateDialog } from '@/components/templates/UseTemplateDialog';
import { usePurchaseTemplate, useTemplateDetail } from '@/hooks/use-templates';
import { useAuthGuard } from '@/hooks/useAuthGuard';
import { formatTemplatePrice, TEMPLATE_CATEGORY_LABELS } from '@/api-types';

export default function TemplateDetailPage() {
	const { slug } = useParams();
	const navigate = useNavigate();
	const detail = useTemplateDetail(slug);
	const purchase = usePurchaseTemplate();
	const { requireAuth } = useAuthGuard();
	const [useOpen, setUseOpen] = useState(false);

	if (detail.isLoading) {
		return (
			<div className="flex justify-center py-24">
				<Loader />
			</div>
		);
	}
	if (detail.isError || !detail.data) {
		return (
			<div className="container max-w-3xl mx-auto px-4 py-16">
				<Empty title="Template not found" description="This template is no longer available." />
			</div>
		);
	}

	const { template, viewer } = detail.data;
	const isPaid = template.priceCents > 0;
	const price = formatTemplatePrice(template.priceCents);
	const intendedUrl = `/templates/${template.slug}`;

	const startUse = () => {
		if (!requireAuth({ requireFullAuth: true, actionContext: 'to use templates', intendedUrl })) return;
		setUseOpen(true);
	};

	const buy = () => {
		if (!requireAuth({ requireFullAuth: true, actionContext: 'to buy templates', intendedUrl })) return;
		purchase.mutate(template.id, {
			onSuccess: () => toast.success(`You own ${template.name}. You can use it now.`),
			onError: (error) => toast.error(error.message),
		});
	};

	return (
		<div className="size-full">
			<title>{pageTitle(template.name)}</title>
			<div className="container max-w-6xl mx-auto px-4 py-8 grid gap-8">
				<button
					type="button"
					className="w-fit text-sm text-kumo-subtle hover:text-kumo-default"
					onClick={() => navigate('/templates')}
				>
					Back to templates
				</button>

				<div className="flex flex-wrap items-start justify-between gap-4">
					<div className="grid max-w-2xl gap-2">
						<h1 className="text-3xl font-semibold text-kumo-strong">{template.name}</h1>
						<p className="text-kumo-subtle">{template.description}</p>
						<p className="text-sm text-kumo-subtle">
							{TEMPLATE_CATEGORY_LABELS[template.category]} · by {template.creatorName}
							{template.publishedAt ? ` · published ${new Date(template.publishedAt).toLocaleDateString()}` : ''} ·{' '}
							{template.useCount} uses
						</p>
					</div>
					<div className="grid justify-items-end gap-2">
						<Badge variant={isPaid ? 'info' : 'success'}>{price}</Badge>
						{viewer.canUse ? (
							<Button variant="primary" onClick={startUse}>
								Use this template
							</Button>
						) : (
							<Button variant="primary" loading={purchase.isPending} onClick={buy}>
								Buy for {price}
							</Button>
						)}
						{isPaid && !viewer.canUse && (
							<p className="text-xs text-kumo-subtle">Payments are in test mode. You won't be charged.</p>
						)}
						{isPaid && viewer.purchased && <p className="text-xs text-kumo-subtle">You own this template.</p>}
					</div>
				</div>

				<div className="grid items-start gap-6 lg:grid-cols-[1fr_260px]">
					<img
						src={template.desktopShotUrl}
						alt={`${template.name} on a desktop`}
						className="w-full rounded-xl ring ring-kumo-hairline"
					/>
					<img
						src={template.mobileShotUrl}
						alt={`${template.name} on a phone`}
						className="w-full max-w-[260px] justify-self-center rounded-2xl ring ring-kumo-hairline"
					/>
				</div>
			</div>
			<UseTemplateDialog template={template} open={useOpen} onOpenChange={setUseOpen} />
		</div>
	);
}
