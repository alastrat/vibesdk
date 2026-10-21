import type { RefObject } from 'react';
import { GitBranch, Github, Expand } from 'lucide-react';
import { ModelConfigInfo } from '@/components/shared/ModelConfigInfo';
import { HeaderButton } from '@/components/shared/header-actions';
import type { ModelConfigsInfo } from '@/api-types';
import { t } from '@/lib/i18n';

export interface BaseHeaderActionsProps {
	containerRef: RefObject<HTMLElement | null>;
	modelConfigs?: ModelConfigsInfo;
	onRequestConfigs: () => void;
	loadingConfigs: boolean;
	onGitCloneClick: () => void;
	isGitHubExportReady: boolean;
	onGitHubExportClick: () => void;
	/** Hide the Clone/GitHub buttons (e.g. think apps surface them in the Repo tab). */
	showGitActions?: boolean;
}

export function BaseHeaderActions({
	containerRef,
	modelConfigs,
	onRequestConfigs,
	loadingConfigs,
	onGitCloneClick,
	isGitHubExportReady,
	onGitHubExportClick,
	showGitActions = true,
}: BaseHeaderActionsProps) {
	return (
		<>
			<ModelConfigInfo
				configs={modelConfigs}
				onRequestConfigs={onRequestConfigs}
				loading={loadingConfigs}
			/>
			{showGitActions && (
				<HeaderButton
					icon={GitBranch}
					label={t('Clone')}
					onClick={onGitCloneClick}
					title={t('Clone to local machine')}
				/>
			)}
			{showGitActions && isGitHubExportReady && (
				<HeaderButton
					icon={Github}
					// i18n-ignore: a brand name
					label="GitHub"
					onClick={onGitHubExportClick}
					title={t('Export to GitHub')}
				/>
			)}
			<HeaderButton
				icon={Expand}
				onClick={() => containerRef.current?.requestFullscreen()}
				title={t('Fullscreen')}
				iconOnly
			/>
		</>
	);
}
