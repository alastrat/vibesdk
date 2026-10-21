import { t, useI18n, msg } from '@/lib/i18n';
import type { ViewDefinition } from '@/api-types';
import type { FeatureModule, FeatureContext } from '../core/types';

// General projects don't have a preview - show a placeholder
function GeneralPreview({ className }: { className?: string }) {
	useI18n();
	return (
		<div className={`${className ?? ''} flex items-center justify-center bg-kumo-base border border-text/10 rounded-lg`}>
			<div className="text-center p-8">
				<p className="text-text-primary/70 text-sm">{t("This project type does not have a live preview.")}<br />{t("View the generated code in the Editor tab.")}</p>
			</div>
		</div>
	);
}

const GENERAL_VIEWS: ViewDefinition[] = [
	{
		id: 'editor',
		label: msg("Code"),
		iconName: 'Code2',
		tooltip: msg("View and edit code"),
	},
	{
		id: 'docs',
		label: msg("Docs"),
		iconName: 'FileText',
		tooltip: msg("View documentation"),
	},
];

const generalFeatureModule: FeatureModule = {
	id: 'general',

	getViews(): ViewDefinition[] {
		return GENERAL_VIEWS.map((view) => ({ ...view, label: t(view.label), tooltip: view.tooltip ? t(view.tooltip) : undefined }));
	},

	PreviewComponent: GeneralPreview,

	onActivate(context: FeatureContext) {
		console.log('[GeneralFeature] Activated for project:', context.projectType);
	},

	onDeactivate(context: FeatureContext) {
		console.log('[GeneralFeature] Deactivated from project:', context.projectType);
	},
};

export default generalFeatureModule;
