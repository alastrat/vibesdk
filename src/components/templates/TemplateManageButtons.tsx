import { toast } from 'sonner';
import { Button } from '@cloudflare/kumo';
import { useSetTemplateListing, useWithdrawTemplateVersion } from '@/hooks/use-templates';
import { templateStatusView } from '@/lib/template-display';
import type { CreatorTemplate } from '@/api-types';

/** The creator's Withdraw and Unlist actions for one template, shown only when its status allows them. */
export function TemplateManageButtons({ template }: { template: CreatorTemplate }) {
	const withdraw = useWithdrawTemplateVersion();
	const listing = useSetTemplateListing();
	const view = templateStatusView(template);
	const pendingVersionId = view.pendingVersionId;

	return (
		<>
			{pendingVersionId && (
				<Button
					size="sm"
					variant="ghost"
					loading={withdraw.isPending}
					onClick={() =>
						withdraw.mutate(
							{ templateId: template.id, versionId: pendingVersionId },
							{ onError: (error) => toast.error(error.message) },
						)
					}
				>
					Withdraw
				</Button>
			)}
			{view.canUnlist && (
				<Button
					size="sm"
					variant="ghost"
					loading={listing.isPending}
					onClick={() =>
						listing.mutate(
							{ templateId: template.id, listed: false },
							{ onError: (error) => toast.error(error.message) },
						)
					}
				>
					Unlist
				</Button>
			)}
		</>
	);
}
