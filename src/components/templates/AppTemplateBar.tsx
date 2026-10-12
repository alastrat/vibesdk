import { useState } from 'react';
import { Badge, Button } from '@cloudflare/kumo';
import { useAppTemplate } from '@/hooks/use-templates';
import { templateStatusView } from '@/lib/template-display';
import type { AppTemplateData, TemplateOrigin } from '@/api-types';
import { SubmitTemplateDialog } from './SubmitTemplateDialog';
import { TemplateManageButtons } from './TemplateManageButtons';
import { TemplateOriginLine } from './TemplateOriginLine';

interface AppTemplateBarProps {
	appId: string;
	appTitle: string;
	origin: TemplateOrigin | null;
	/** The viewer owns this Think app and may submit it. */
	canManage: boolean;
}

/** The app page strip for template origin and the owner's template status and actions. */
export function AppTemplateBar({ appId, appTitle, origin, canManage }: AppTemplateBarProps) {
	const status = useAppTemplate(appId, canManage);
	const data = canManage ? status.data : undefined;
	const showActions = !!data && (data.eligible || data.template !== null);
	if (!origin && !showActions) return null;

	return (
		<div className="shrink-0 flex flex-wrap items-center justify-between gap-2 border-b bg-kumo-base px-4 py-2">
			{origin ? <TemplateOriginLine origin={origin} /> : <span />}
			{showActions && data && <TemplateActions appId={appId} appTitle={appTitle} data={data} />}
		</div>
	);
}

function TemplateActions({ appId, appTitle, data }: { appId: string; appTitle: string; data: AppTemplateData }) {
	const [dialogOpen, setDialogOpen] = useState(false);
	const template = data.template;
	const view = template ? templateStatusView(template) : null;
	const pendingVersionId = view?.pendingVersionId ?? null;
	const canSubmit = data.eligible && pendingVersionId === null;

	return (
		<div className="flex flex-wrap items-center gap-2">
			{view && (
				<>
					<span className="text-sm text-kumo-subtle">Template</span>
					<Badge variant={view.variant}>{view.label}</Badge>
					{view.detail && <span className="text-sm text-kumo-subtle">{view.detail}</span>}
				</>
			)}
			{template && <TemplateManageButtons template={template} />}
			{canSubmit && (
				<Button size="sm" variant="secondary" onClick={() => setDialogOpen(true)}>
					{template ? 'Submit new version' : 'Submit as template'}
				</Button>
			)}
			<SubmitTemplateDialog appId={appId} appTitle={appTitle} open={dialogOpen} onOpenChange={setDialogOpen} />
		</div>
	);
}
