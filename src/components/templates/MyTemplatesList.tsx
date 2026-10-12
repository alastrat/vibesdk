import { useNavigate } from 'react-router';
import { Badge, Button, Empty, Loader } from '@cloudflare/kumo';
import { SquaresFourIcon } from '@phosphor-icons/react';
import { useMyTemplates } from '@/hooks/use-templates';
import { templateStatusView } from '@/lib/template-display';
import { formatTemplatePrice } from '@/api-types';

export function MyTemplatesList() {
	const navigate = useNavigate();
	const mine = useMyTemplates();

	if (mine.isLoading) {
		return (
			<div className="flex justify-center py-10">
				<Loader />
			</div>
		);
	}
	if (mine.isError) {
		return <Empty size="sm" title="Templates didn't load" description={mine.error.message} />;
	}
	const templates = mine.data?.templates ?? [];
	if (templates.length === 0) {
		return (
			<Empty
				size="sm"
				icon={<SquaresFourIcon size={40} weight="duotone" className="text-kumo-inactive" />}
				title="No templates yet"
				description="Open one of your deployed apps and choose Submit as template."
			/>
		);
	}

	return (
		<div className="grid gap-3">
			{templates.map((template) => {
				const view = templateStatusView(template);
				const versionCount = template.versions.length;
				return (
					<div
						key={template.id}
						className="flex flex-wrap items-center justify-between gap-3 rounded-lg px-3 py-3 ring ring-kumo-hairline"
					>
						<div className="grid min-w-0 gap-0.5">
							<p className="truncate text-sm font-medium text-kumo-default">{template.name}</p>
							<p className="text-sm text-kumo-subtle">
								{formatTemplatePrice(template.priceCents)} · {versionCount} version{versionCount === 1 ? '' : 's'} ·{' '}
								{template.useCount} uses{view.detail ? ` · ${view.detail}` : ''}
							</p>
						</div>
						<div className="flex items-center gap-2">
							<Badge variant={view.variant}>{view.label}</Badge>
							{template.status === 'listed' && (
								<Button size="sm" variant="ghost" onClick={() => navigate(`/templates/${template.slug}`)}>
									View
								</Button>
							)}
						</div>
					</div>
				);
			})}
		</div>
	);
}
