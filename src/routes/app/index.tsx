import type { FileType } from '@/api-types';
import { MonacoEditor } from '@/components/monaco-editor/lazy-monaco-editor';
import { AppLoadingSkeleton } from '@/components/shared/AppLoadingSkeleton';
import { FloatingBackgroundIcons } from '@/components/shared/FloatingBackgroundIcons';
import { ConfirmDeleteDialog } from '@/components/shared/ConfirmDeleteDialog';
import { GitCloneModal } from '@/components/shared/GitCloneModal';
import { PublishDialog } from '@/components/publishing/PublishDialog';
import { SiteReuseBar } from '@/components/publishing/SiteReuseBar';
import { UseSiteButton } from '@/components/publishing/UseSiteButton';
import {
	useApp,
	useAppPreviewToken,
	useDeleteApp,
	useDeployPreview,
	useToggleAppFavorite,
	useToggleAppStar,
} from '@/hooks/use-app';
import { useAuth } from '@/contexts/auth-context';
import { useConfirmCheckoutReturn } from '@/hooks/use-payments';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { useAuthGuard } from '@/hooks/useAuthGuard';
import { ApiError } from '@/lib/api-client';
import { getPreviewUrl } from '@/lib/utils';
import { msg, useI18n } from '@/lib/i18n';
import { visibilityLabel } from '@/lib/visibility-label';
import { getFileType } from '@/utils/string';
import {
	Badge,
	Button,
	DropdownMenu,
	LayerCard,
	Tabs,
	useKumoToastManager,
} from '@cloudflare/kumo';
import {
	BookmarkSimple,
	Code,
	CopyIcon,
	DotsThree,
	GitBranch,
	GithubLogo,
	Globe,
	Lock,
	LockOpen,
	Star,
	TrashIcon,
} from '@phosphor-icons/react';
import {
	Check,
	ChevronLeft,
	Code2,
	Copy,
	ExternalLink,
	Eye,
	MessageSquare,
	Play,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { usePageHeader } from '@/components/layout/header-context';
import { pageTitle } from '@/brand';
import { FileExplorer } from '../chat/components/file-explorer';
import { PreviewIframe } from '../chat/components/preview-iframe';

// Define supported actions for OAuth redirect
type PendingAction = 'favorite' | 'bookmark' | 'star' | 'fork' | 'remix';

// Supported actions constant for validation
const SUPPORTED_ACTIONS: PendingAction[] = [
	'favorite',
	'bookmark',
	'star',
	'fork',
	'remix',
];

// Action configuration type for reusability
interface ActionConfig {
	action: PendingAction;
	context: string;
	handler: () => Promise<void>;
	errorMessage: string;
}

// Action mapping for aliases (bookmark -> favorite, remix -> fork)
const ACTION_MAP: Record<PendingAction, string> = {
	favorite: 'favorite',
	bookmark: 'favorite',
	star: 'star',
	fork: 'fork',
	remix: 'fork',
};
export default function AppView() {
	const { id } = useParams();
	const navigate = useNavigate();
	const [searchParams, setSearchParams] = useSearchParams();
	const { user } = useAuth();
	const { requireAuth } = useAuthGuard();
	const { t } = useI18n();
	const { app, loading, error } = useApp(id);
	useConfirmCheckoutReturn(app);
	const { copied: urlCopied, copy: copyUrl } = useCopyToClipboard({
		errorMessage: t('Failed to copy'),
	});
	const { copy: copyFile } = useCopyToClipboard({
		successMessage: t('Code copied to clipboard'),
		errorMessage: t('Failed to copy'),
	});
	const { copy: copyPrompt } = useCopyToClipboard({
		successMessage: t('Prompt copied to clipboard'),
		errorMessage: t('Failed to copy'),
	});
	const [activeTab, setActiveTab] = useState('preview');
	const [deploymentProgress, setDeploymentProgress] = useState<string>('');
	const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
	const [deleteError, setDeleteError] = useState<string>();
	const [isGitCloneModalOpen, setIsGitCloneModalOpen] = useState(false);
	const [publishOpen, setPublishOpen] = useState(false);
	const [activeFilePath, setActiveFilePath] = useState<string>();
	const previewIframeRef = useRef<HTMLIFrameElement>(null);
	const autoDeployAppIdRef = useRef<string | undefined>(undefined);
	const [thinkPreviewUrl, setThinkPreviewUrl] = useState<string>();

	// Route reuses this component across /app/:id — clear deploy UI on switch
	useEffect(() => {
		setDeploymentProgress('');
		autoDeployAppIdRef.current = undefined;
		setThinkPreviewUrl(undefined);
		setActiveTab('preview');
		setActiveFilePath(undefined);
	}, [id]);

	const needsOwnerPreviewToken =
		!!app &&
		!!user &&
		app.userId === user.id &&
		app.visibility === 'private' &&
		!!app.deploymentId;

	const { previewUrl: ownerPreviewUrl } = useAppPreviewToken(
		app?.id,
		needsOwnerPreviewToken,
	);

	const { mutateAsync: toggleFavorite } = useToggleAppFavorite(app?.id);
	const { mutateAsync: toggleStar } = useToggleAppStar(app?.id);
	const { mutateAsync: deleteApp, isPending: isDeleting } = useDeleteApp();
	const { mutateAsync: deployPreview, isPending: isDeploying } =
		useDeployPreview(app?.id);

	const isFavorited = app?.userFavorited || false;
	const isStarred = app?.userStarred || false;

	// Convert agent files to chat FileType format
	const files = useMemo<FileType[]>(() => {
		if (!app?.agentSummary?.generatedCode) return [];
		return app.agentSummary.generatedCode
			.filter(
				(file) =>
					file && file.filePath && typeof file.filePath === 'string',
			)
			.map((file) => ({
				filePath: file.filePath,
				fileContents: file.fileContents || '',
				explanation:
					// i18n-ignore: the marker Think writes as a file's purpose
					file.filePurpose === 'Generated by think'
						? undefined
						: file.filePurpose,
				language: getFileType(file.filePath),
				isGenerating: false,
				needsFixing: false,
				hasErrors: false,
			}));
	}, [app?.agentSummary?.generatedCode]);

	// Get active file
	const activeFile = useMemo(() => {
		return files.find((file) => file.filePath === activeFilePath);
	}, [files, activeFilePath]);

	// Auto-select first file; recover if selected path vanished from the list
	useEffect(() => {
		if (files.length === 0) return;
		const stillThere = files.some(
			(file) => file.filePath === activeFilePath,
		);
		if (!activeFilePath || !stillThere) {
			setActiveFilePath(files[0].filePath);
		}
	}, [files, activeFilePath]);

	// File click handler
	const handleFileClick = useCallback((file: FileType) => {
		setActiveFilePath(file.filePath);
	}, []);

	const toast = useKumoToastManager();

	// Action configuration for reusability
	const actionConfigs: Record<string, ActionConfig> = useMemo(
		() => ({
			favorite: {
				action: 'favorite',
				context: msg('Sign in to bookmark apps'),
				handler: async () => {
					const newState = await toggleFavorite();
					toast.add({
						title: newState
							? t('Added to bookmarks')
							: t('Removed from bookmarks'),
						variant: 'success',
					});
				},
				errorMessage: t('Failed to update bookmarks'),
			},
			star: {
				action: 'star',
				context: msg('Sign in to star apps'),
				handler: async () => {
					const data = await toggleStar();
					toast.add({
						title: data.isStarred ? t('Starred!') : t('Unstarred'),
						variant: 'success',
					});
				},
				errorMessage: t('Failed to update star'),
			},
		}),
		[t, toast, toggleFavorite, toggleStar],
	);

	// Reusable authenticated action handler
	const createAuthenticatedHandler = useCallback(
		(configKey: string) => {
			return async () => {
				if (!app) return;

				const config = actionConfigs[configKey];
				if (!config) return;

				const currentUrl = `/app/${app.id}?action=${config.action}`;

				// Use auth guard with action parameter in intended URL
				if (
					!requireAuth({
						requireFullAuth: true,
						actionContext: config.context,
						intendedUrl: currentUrl,
					})
				) {
					return;
				}

				// User is authenticated, execute immediately
				try {
					await config.handler();
				} catch (error) {
					console.error(`${config.action} error:`, error);
					toast.add({
						title:
							error instanceof ApiError
								? error.message
								: config.errorMessage,
						variant: 'error',
					});
				}
			};
		},
		[actionConfigs, app, requireAuth, toast],
	);

	// Create action handlers using the reusable pattern
	const handleFavorite = useMemo(
		() => createAuthenticatedHandler('favorite'),
		[createAuthenticatedHandler],
	);

	const handleStar = useMemo(
		() => createAuthenticatedHandler('star'),
		[createAuthenticatedHandler],
	);

	// Handle pending actions after OAuth redirect
	const executePendingAction = useCallback(
		async (action: PendingAction) => {
			if (!app) return;

			const configKey = ACTION_MAP[action];
			if (!configKey) {
				console.warn('Unknown pending action:', action);
				return;
			}

			const config = actionConfigs[configKey];
			if (!config) {
				console.warn('No config found for action:', action);
				return;
			}

			try {
				await config.handler();
			} catch (error) {
				console.error(
					'Failed to execute pending action:',
					action,
					error,
				);
				toast.add({
					title:
						error instanceof ApiError
							? error.message
							: config.errorMessage,
					variant: 'error',
				});
			}
		},
		[actionConfigs, app, toast],
	);

	// Effect to handle pending actions after OAuth redirect
	useEffect(() => {
		if (!user || !app || loading) return;

		const actionParam = searchParams.get('action');
		if (!actionParam) return;

		// Validate action parameter against our supported types
		const action = SUPPORTED_ACTIONS.find((a) => a === actionParam);

		if (!action) {
			console.warn('Unsupported action parameter:', actionParam);
			return;
		}

		// Clear the action parameter from URL first
		const newSearchParams = new URLSearchParams(searchParams);
		newSearchParams.delete('action');
		setSearchParams(newSearchParams, { replace: true });

		// Execute the pending action
		executePendingAction(action);
	}, [
		user,
		app,
		loading,
		searchParams,
		setSearchParams,
		executePendingAction,
	]);

	const isSignedIn = !!user;
	const isOwner = !!app && app.userId === user?.id;
	const isThink = app?.behaviorType === 'think';
	// Think apps auto-load their live SpaceDO preview for signed-in viewers
	// (see the effect below). Anonymous viewers can't hit the auth-gated deploy
	// endpoint, so they fall back to the same manual affordance as non-Think apps.
	const isAutoLoadingPreview = isThink && !!user;
	// Think prefers its live preview over the production deployment link. For
	// signed-in viewers we withhold the deployed link until the preview resolves
	// so the preview always wins; anonymous viewers fall back to it.
	const appUrl = isThink
		? user
			? thinkPreviewUrl || ''
			: app?.cloudflareUrl || app?.previewUrl || ''
		: ownerPreviewUrl || app?.cloudflareUrl || app?.previewUrl || '';
	const promptText = app?.agentSummary?.query || app?.originalPrompt || '';

	const handleCopyUrl = () => {
		if (!appUrl) return;
		copyUrl(appUrl);
	};

	const handlePreviewDeploy = async () => {
		if (!app || isDeploying) return;

		try {
			setDeploymentProgress(t('Connecting to agent...'));
			const data = await deployPreview();
			if (data.previewURL || data.tunnelURL) {
				setDeploymentProgress(t('Deployment complete!'));
			}
		} catch (error) {
			console.error('Error starting deployment:', error);
			setDeploymentProgress(t('Failed to start deployment'));
			toast.add({
				title: t('Failed to start deployment'),
				variant: 'error',
			});
		}
	};

	// Auto-load the preview for Think apps so viewers don't have to click
	// "Deploy". Gated to authenticated users: the preview endpoint requires
	// auth (and applies per-user rate limiting), so anonymous visitors would
	// only get a 401. They still see the manual deploy affordance below.
	useEffect(() => {
		if (
			!app ||
			!user ||
			app.behaviorType !== 'think' ||
			thinkPreviewUrl ||
			autoDeployAppIdRef.current === app.id
		) {
			return;
		}

		autoDeployAppIdRef.current = app.id;
		setDeploymentProgress(t('Loading preview...'));
		void deployPreview()
			.then((data) => {
				const url = getPreviewUrl(data.previewURL, data.tunnelURL);
				if (url) setThinkPreviewUrl(url);
			})
			.catch((error) => {
				console.error('Error loading Think preview:', error);
				setDeploymentProgress(t('Failed to load preview'));
				toast.add({
					title: t('Failed to load preview'),
					variant: 'error',
				});
			});
	}, [app, thinkPreviewUrl, deployPreview, t, toast, user]);

	const headerContent = useMemo(() => {
		if (loading || error || !app) return null;

		return {
			leading: (
				<div className="min-w-0 flex-1 flex items-center gap-2">
					<h1
						className="text-sm max-w-sm font-semibold truncate min-w-0"
						title={app.title}
					>
						{app.title}
					</h1>
					<Badge
						className="shrink-0"
						variant={
							app.visibility === 'private'
								? 'secondary'
								: 'success'
						}
					>
						<span className="inline-flex items-center gap-1">
							<Globe className="h-3 w-3" weight="duotone" />
							{visibilityLabel(app.visibility)}
						</span>
					</Badge>
				</div>
			),
			trailing: (
				<>
					<UseSiteButton
						app={app}
						autoOpen={searchParams.get('use') === '1'}
					/>
					{isSignedIn && isOwner && (
						<Button
							variant="secondary"
							size="sm"
							onClick={() => setPublishOpen(true)}
							icon={
								app.visibility === 'private' ? (
									<LockOpen
										className="size-3.5"
										weight="duotone"
									/>
								) : (
									<Lock
										className="size-3.5"
										weight="duotone"
									/>
								)
							}
						>
							{app.visibility === 'private'
								? t('Make public')
								: t('Publishing')}
						</Button>
					)}

					{app.githubRepositoryUrl && (
						<Button
							variant="secondary"
							size="sm"
							icon={
								<GithubLogo
									className="size-3.5"
									weight="duotone"
								/>
							}
							title={app.githubRepositoryVisibility === 'private' ? t('View on GitHub (private)') : t('View on GitHub (public)')}
							onClick={() => {
								if (app.githubRepositoryUrl) {
									window.open(
										app.githubRepositoryUrl,
										'_blank',
										'noopener,noreferrer',
									);
								}
							}}
						>
							{/* i18n-ignore: brand name */}
							GitHub
							{app.githubRepositoryVisibility === 'private' && (
								<Lock
									className="h-3 w-3 opacity-70"
									weight="duotone"
								/>
							)}
						</Button>
					)}

					{isSignedIn && isOwner && (
						<>
							<Button
								variant="primary"
								size="sm"
								icon={
									<Code
										className="size-3.5"
										weight="duotone"
									/>
								}
								onClick={() => navigate(`/chat/${app.id}`)}
							>
								{t('Make edits')}
							</Button>

							<DropdownMenu>
								<DropdownMenu.Trigger
									render={
										<Button
											variant="secondary"
											size="sm"
											shape="square"
											aria-label={t('More actions')}
											icon={
												<DotsThree className="h-4 w-4" />
											}
										/>
									}
								/>
								<DropdownMenu.Content align="end">
									<DropdownMenu.Item
										icon={TrashIcon}
										variant="danger"
										onClick={() => {
											setDeleteError(undefined);
											setIsDeleteDialogOpen(true);
										}}
									>
										{t('Delete app')}
									</DropdownMenu.Item>
								</DropdownMenu.Content>
							</DropdownMenu>
						</>
					)}
				</>
			),
		};
	}, [
		loading,
		error,
		app,
		isSignedIn,
		isOwner,
		navigate,
		searchParams,
		t,
	]);

	usePageHeader(headerContent);

	const handleDeleteApp = async () => {
		if (!app) return;

		try {
			setDeleteError(undefined);
			await deleteApp(app.id);
			toast.add({
				title: t('App deleted successfully'),
				variant: 'success',
			});
			setIsDeleteDialogOpen(false);

			if (window.history.length > 1) {
				navigate(-1);
			} else {
				navigate('/apps');
			}
		} catch (error) {
			console.error('Error deleting app:', error);
			setDeleteError(
				error instanceof ApiError
					? error.message
					: t('An unexpected error occurred while deleting the app'),
			);
		}
	};

	if (loading) {
		return (
			<>
				<title>{pageTitle(t('Loading'))}</title>
				<AppLoadingSkeleton />
			</>
		);
	}

	if (error || !app) {
		return (
			<div className="size-full flex items-center justify-center p-4">
				<title>{pageTitle(t('App not found'))}</title>
				<LayerCard className="max-w-md w-full px-5 py-6">
					<div className="text-center grid gap-4">
						<div className="grid gap-1.5">
							<h2 className="text-lg font-semibold text-text-primary">
								{t('App not found')}
							</h2>
							<p className="text-sm text-kumo-subtle">
								{error ||
									t("The app you're looking for doesn't exist.")}
							</p>
						</div>
						<div className="flex justify-center">
							<Button
								variant="secondary"
								size="sm"
								icon={<ChevronLeft className="h-4 w-4" />}
								onClick={() => navigate('/apps')}
							>
								{t('Back to apps')}
							</Button>
						</div>
					</div>
				</LayerCard>
			</div>
		);
	}

	// Viewers who may not read the source get the preview in place of the code.
	const shownTab =
		activeTab === 'code' && !app.codeVisible ? 'preview' : activeTab;
	// A paid listing's repository can only be cloned with the owner's token.
	const canClone = app.codeVisible && (isOwner || !app.cloneNeedsToken);

	return (
		<div className="size-full flex flex-col min-h-0">
			<title>{pageTitle(app.title || t('App'))}</title>
			<SiteReuseBar app={app} isOwner={isOwner} />
			{isOwner && (
				<PublishDialog
					appId={app.id}
					open={publishOpen}
					onOpenChange={setPublishOpen}
				/>
			)}
			<div className="shrink-0 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-4 py-2 border-b bg-kumo-base">
				<Tabs
					value={shownTab}
					onValueChange={setActiveTab}
					className="w-fit"
					tabs={[
						{
							value: 'preview',
							label: (
								<span className="inline-flex items-center gap-1.5">
									<Eye className="size-3.5" />
									{t('Preview')}
								</span>
							),
						},
						...(app.codeVisible
							? [
									{
										value: 'code',
										label: (
											<span className="inline-flex items-center gap-1.5">
												<Code2 className="size-3.5" />
												{t('Code')}
												{files.length > 0 && (
													<span className="text-kumo-subtle tabular-nums">
														{files.length}
													</span>
												)}
											</span>
										),
									},
								]
							: []),
						{
							value: 'prompt',
							label: (
								<span className="inline-flex items-center gap-1.5">
									<MessageSquare className="size-3.5" />
									{t('Prompt')}
								</span>
							),
						},
					]}
				/>

				<div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
					{isSignedIn && (
						<>
							<Button
								variant="secondary"
								size="sm"
								icon={
									<BookmarkSimple
										className="size-3.5"
										weight={isFavorited ? 'fill' : 'duotone'}
									/>
								}
								onClick={() => {
									void handleFavorite();
								}}
							>
								{isFavorited ? t('Bookmarked') : t('Bookmark')}
							</Button>

							<Button
								variant="secondary"
								size="sm"
								icon={
									<Star
										className="size-3.5"
										weight={isStarred ? 'fill' : 'duotone'}
									/>
								}
								onClick={handleStar}
							>
								{isStarred ? t('Starred') : t('Star')}
								{(app.starCount || 0) > 0 && (
									<span className="text-kumo-subtle tabular-nums">
										{app.starCount}
									</span>
								)}
							</Button>
						</>
					)}

					{canClone && (
						<Button
							variant="secondary"
							size="sm"
							icon={
								<GitBranch className="size-3.5" weight="duotone" />
							}
							onClick={() => setIsGitCloneModalOpen(true)}
						>
							{t('Clone')}
						</Button>
					)}
				</div>
			</div>

			{/* Full-bleed workspace */}
			<div className="flex-1 min-h-0 flex flex-col">
				{shownTab === 'preview' && (
					<div className="flex-1 min-h-0 flex flex-col overflow-hidden">
						<div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-kumo-line bg-kumo-elevated/40">
							<span className="text-sm font-medium text-text-primary shrink-0">
								{t('Live preview')}
							</span>
							{appUrl && (
								<>
									<code className="min-w-0 flex-1 truncate font-mono text-[0.9em] text-kumo-subtle px-2">
										{appUrl}
									</code>
									<div className="flex items-center gap-0.5 shrink-0">
										<Button
											variant="ghost"
											size="sm"
											shape="square"
											aria-label={
												urlCopied
													? t('Copied')
													: t('Copy URL')
											}
											title={
												urlCopied
													? t('Copied')
													: t('Copy URL')
											}
											onClick={handleCopyUrl}
											icon={
												urlCopied ? (
													<Check className="size-3.5" />
												) : (
													<Copy className="size-3.5" />
												)
											}
										/>
										<Button
											variant="ghost"
											size="sm"
											shape="square"
											aria-label={t('Open in new tab')}
											title={t('Open in new tab')}
											onClick={() =>
												window.open(appUrl, '_blank', 'noopener,noreferrer')
											}
											icon={
												<ExternalLink className="size-3.5" />
											}
										/>
									</div>
								</>
							)}
						</div>
						<div className="flex-1 min-h-0 relative">
							{appUrl ? (
								<PreviewIframe
									ref={previewIframeRef}
									src={appUrl}
									className="absolute inset-0 size-full"
									title={t('{title} Preview', { title: app.title })}
								/>
							) : (
								<div className="absolute inset-0 flex items-center justify-center">
									<FloatingBackgroundIcons />

									<div className="relative z-10 text-center p-8 grid gap-4 max-w-md">
										<div className="grid gap-1.5">
											<h3 className="text-xl font-semibold">
												{isAutoLoadingPreview
													? t('Loading preview')
													: t('Run app')}
											</h3>
											<p className="text-kumo-subtle text-sm">
												{isAutoLoadingPreview
													? t('Preparing this app preview.')
													: t('Deploy a preview to see this app live.')}
											</p>
											{deploymentProgress && (
												<p className="text-sm text-kumo-subtle">
													{deploymentProgress}
												</p>
											)}
										</div>
										{!isAutoLoadingPreview && (
											<div className="flex justify-center">
												<Button
													variant="primary"
													onClick={
														handlePreviewDeploy
													}
													disabled={isDeploying}
													loading={isDeploying}
													icon={
														!isDeploying ? (
															<Play className="h-4 w-4" />
														) : undefined
													}
												>
													{isDeploying
														? t('Deploying...')
														: t('Deploy for preview')}
												</Button>
											</div>
										)}
									</div>
								</div>
							)}
						</div>
					</div>
				)}

				{shownTab === 'code' && (
					<div className="flex-1 min-h-0 flex flex-col overflow-hidden">
						<div className="shrink-0 flex items-center justify-between gap-2 px-3 py-2 border-b border-kumo-line bg-kumo-elevated/40">
							<div className="min-w-0 flex items-center gap-2">
								<span className="text-sm font-medium text-text-primary shrink-0">
									{t('Project files')}
								</span>
								{/*{app?.agentSummary && (
									<span className="text-xs text-kumo-subtle">
										{files.length} files
									</span>
								)}*/}
							</div>
							{activeFile && (
								<Button
									variant="ghost"
									size="sm"
									icon={
										<CopyIcon
											weight="duotone"
											className="size-3.5"
										/>
									}
									onClick={() => {
										void copyFile(activeFile.fileContents);
									}}
								>
									{t('Copy file')}
								</Button>
							)}
						</div>

						{files.length > 0 ? (
							<div className="flex-1 min-h-0 flex">
								<FileExplorer
									files={files}
									currentFile={activeFile}
									onFileClick={handleFileClick}
									className="w-56 sm:w-64 max-w-none shrink-0 bg-kumo-elevated/20"
								/>

								<div className="flex-1 min-w-0 min-h-0 flex flex-col">
									{activeFile ? (
										<>
											{activeFile.explanation && (
												<div className="shrink-0 px-3 py-1.5 border-b border-kumo-line text-xs text-kumo-subtle truncate">
													{activeFile.explanation}
												</div>
											)}
											<div className="flex-1 min-h-0">
												<MonacoEditor
													className="h-full"
													path={activeFile.filePath}
													createOptions={{
														value: activeFile.fileContents,
														language:
															activeFile.language ||
															'plaintext',
														readOnly: true,
														minimap: {
															enabled: false,
														},
														lineNumbers: 'on',
														scrollBeyondLastLine: false,
														fontSize: 13,
														automaticLayout: true,
													}}
												/>
											</div>
										</>
									) : (
										<div className="flex-1 flex items-center justify-center">
											<p className="text-sm text-kumo-subtle">
												{t('Select a file to view')}
											</p>
										</div>
									)}
								</div>
							</div>
						) : (
							<div className="flex-1 flex items-center justify-center">
								<p className="text-sm text-kumo-subtle">
									{app?.agentSummary === null
										? t('Loading code...')
										: t('No code has been generated yet.')}
								</p>
							</div>
						)}
					</div>
				)}

				{shownTab === 'prompt' && (
					<div className="flex-1 min-h-0 flex flex-col overflow-hidden relative">
						<div className="flex-1 min-h-0 overflow-y-auto flex items-center justify-center p-6 sm:p-10">
							{promptText ? (
								<div className="w-full max-w-2xl grid gap-5">
									<div className="flex items-end justify-between gap-4">
										<div className="grid gap-1 min-w-0">
											<div className="flex items-center gap-2">
												<span className="h-lh flex items-center shrink-0">
													<span className="rounded-md bg-brand/10 p-1.5">
														<MessageSquare className="size-3.5 text-kumo-brand" />
													</span>
												</span>
												<h2 className="text-base font-semibold text-text-primary">
													{t('Original prompt')}
												</h2>
											</div>
											<p className="text-sm text-kumo-subtle pl-9">
												{t('The idea that started this app')}
											</p>
										</div>
										<Button
											variant="secondary"
											size="sm"
											icon={
												<CopyIcon
													className="size-3.5"
													weight="duotone"
												/>
											}
											onClick={() => {
												void copyPrompt(promptText);
											}}
										>
											{t('Copy')}
										</Button>
									</div>
									<div className="max-h-[min(60vh,28rem)] overflow-auto rounded-xl bg-kumo-elevated ring ring-kumo-line px-5 py-4">
										<p className="text-sm text-text-primary whitespace-pre-wrap break-words leading-relaxed">
											{promptText}
										</p>
									</div>
								</div>
							) : (
								<div className="grid place-items-center gap-3 text-center">
									<span className="rounded-full bg-kumo-elevated ring ring-kumo-line p-3">
										<MessageSquare className="size-5 text-kumo-subtle" />
									</span>
									<div className="grid gap-1">
										<p className="text-sm font-medium text-text-primary">
											{app?.agentSummary === null
												? t('Loading prompt')
												: t('No prompt available')}
										</p>
										{app?.agentSummary !== null && (
											<p className="text-sm text-kumo-subtle">
												{t('This app has no saved original prompt')}
											</p>
										)}
									</div>
								</div>
							)}
						</div>
					</div>
				)}
			</div>

			{app && (
				<ConfirmDeleteDialog
					open={isDeleteDialogOpen}
					onOpenChange={setIsDeleteDialogOpen}
					resourceType={t('app')}
					deleteButtonText={t('Delete App')}
					resourceName={app.title}
					onDelete={handleDeleteApp}
					isDeleting={isDeleting}
					errorMessage={deleteError}
					className="sm:w-[32rem]"
				/>
			)}

			<GitCloneModal
				open={isGitCloneModalOpen}
				onOpenChange={setIsGitCloneModalOpen}
				appId={app.id}
				appTitle={app.title}
				isPublic={!app.cloneNeedsToken}
				isOwner={isOwner}
			/>
		</div>
	);
}
