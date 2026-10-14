import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import { InfoIcon, PaperPlaneTiltIcon } from '@phosphor-icons/react';
import { useAuth } from '@/contexts/auth-context';
import {
	ProjectModeSelector,
	type ProjectModeOption,
} from '@/components/project-mode-selector';
import {
	MAX_AGENT_QUERY_LENGTH,
	SUPPORTED_IMAGE_MIME_TYPES,
	type ProjectType,
	type BehaviorType,
} from '@/api-types';
import { useFeature } from '@/features';
import { useAuthGuard } from '@/hooks/useAuthGuard';
import { useImageUpload } from '@/hooks/use-image-upload';
import { useDragDrop } from '@/hooks/use-drag-drop';
import { useLimitsContext } from '@/contexts/limits-context';
import { checkCanSendPrompt } from '@/utils/usage-limit-checker';
import { PromptBox } from '@/components/prompt-box';
import { ThinkModelPicker } from '@/components/ThinkModelPicker';
import { startCloudflareConnect } from '@/lib/cloudflare-connect';

const DEFAULT_PLACEHOLDER_PHRASES = ['todo list app', 'F1 fantasy game', 'personal finance tracker'];

interface BuildBoxProps {
	/** Text before the animated phrases; the home page uses "Create a ". */
	placeholder?: string;
	/** Keep the array stable (module constant or memoized) so the typewriter doesn't restart. */
	placeholderPhrases?: string[];
	className?: string;
}

/** The prompt that starts a new build: signed-out visitors sign up first, then land in their build. */
export function BuildBox({
	placeholder = 'Create a ',
	placeholderPhrases = DEFAULT_PLACEHOLDER_PHRASES,
	className,
}: BuildBoxProps) {
	const navigate = useNavigate();
	const { requireAuth } = useAuthGuard();
	const [projectMode, setProjectMode] = useState<ProjectType>('app');
	const behaviorMode: Extract<BehaviorType, 'think' | 'phasic'> = 'think';
	const [query, setQuery] = useState('');
	const [modelId, setModelId] = useState('');
	const { user } = useAuth();
	const { isLoadingCapabilities, capabilities, getEnabledFeatures } =
		useFeature();

	useEffect(() => {
		if (!modelId && capabilities?.defaultThinkModel) {
			setModelId(capabilities.defaultThinkModel);
		}
	}, [capabilities, modelId]);
	const { data: limitsData, loading: usageLimitsLoading } =
		useLimitsContext();
	const [showLimitDialog, setShowLimitDialog] =
		useState<ReactElement | null>(null);

	const handleConnectCloudflare = useCallback(() => {
		void startCloudflareConnect(window.location.href);
	}, []);

	const modeOptions = useMemo<ProjectModeOption[]>(() => {
		if (isLoadingCapabilities || !capabilities) return [];
		return getEnabledFeatures().map((def) => ({
			id: def.id,
			label:
				def.id === 'presentation'
					? 'Slides'
					: def.id === 'general'
						? 'General'
						: 'App',
			description: def.description,
		}));
	}, [capabilities, getEnabledFeatures, isLoadingCapabilities]);

	const showModeSelector = modeOptions.length > 1;

	useEffect(() => {
		if (isLoadingCapabilities) return;
		if (modeOptions.length === 0) {
			if (projectMode !== 'app') setProjectMode('app');
			return;
		}
		if (!modeOptions.some((m) => m.id === projectMode)) {
			setProjectMode(modeOptions[0].id);
		}
	}, [isLoadingCapabilities, modeOptions, projectMode]);

	const { images, addImages, removeImage, clearImages, isProcessing } =
		useImageUpload({
			onError: (error) => {
				console.error('Image upload error:', error);
				toast.error(error);
			},
		});

	const { isDragging, dragHandlers } = useDragDrop({
		onFilesDropped: addImages,
		accept: [...SUPPORTED_IMAGE_MIME_TYPES],
	});

	const handleCreateApp = (query: string, mode: ProjectType) => {
		if (query.length > MAX_AGENT_QUERY_LENGTH) {
			toast.error(
				`Prompt too large (${query.length} characters). Maximum allowed is ${MAX_AGENT_QUERY_LENGTH} characters.`,
			);
			return;
		}

		if (user && usageLimitsLoading) {
			return;
		}

		const encodedQuery = encodeURIComponent(query);
		const encodedMode = encodeURIComponent(mode);
		const behaviorParam =
			mode === 'app'
				? `&behaviorType=${encodeURIComponent(behaviorMode)}`
				: '';

		// Encode images as JSON if present
		const imageParam =
			images.length > 0
				? `&images=${encodeURIComponent(JSON.stringify(images))}`
				: '';
		const modelParam = mode === 'app' && modelId ? `&model=${encodeURIComponent(modelId)}` : '';
		const intendedUrl = `/chat/new?query=${encodedQuery}&projectType=${encodedMode}${behaviorParam}${modelParam}${imageParam}`;

		if (
			!requireAuth({
				requireFullAuth: true,
				actionContext: 'to create applications',
				intendedUrl: intendedUrl,
			})
		) {
			return;
		}

		// Check usage limits before proceeding
		const limitCheck = checkCanSendPrompt(
			limitsData,
			usageLimitsLoading,
			() => {
				void startCloudflareConnect(window.location.href);
			},
			() => setShowLimitDialog(null),
		);

		if (!limitCheck.canProceed) {
			setShowLimitDialog(limitCheck.dialogComponent || null);
			return;
		}

		// User is already authenticated, navigate immediately. Mark the
		// navigation as in-app so the chat session can auto-start without the
		// external-link confirmation gate.
		navigate(intendedUrl, { state: { fromPrompt: true } });
		// Clear images after navigation
		clearImages();
	};

	return (
		<div className={className}>
			<PromptBox
				value={query}
				onChange={setQuery}
				onSubmit={() => handleCreateApp(query, projectMode)}
				placeholder={placeholder}
				animatedPlaceholder
				placeholderPhrases={placeholderPhrases}
				images={images}
				onAddImages={addImages}
				onRemoveImage={removeImage}
				isProcessing={
					isProcessing ||
					(user ? usageLimitsLoading : false)
				}
				isDragging={isDragging}
				dragHandlers={dragHandlers}
				submitDisabled={user ? usageLimitsLoading : false}
				limitsData={user ? limitsData : undefined}
				onConnectCloudflare={handleConnectCloudflare}
				variant="expanded"
				submitIcon={
					user && usageLimitsLoading ? (
						<Loader2 className="animate-spin" />
					) : (
						<PaperPlaneTiltIcon weight="duotone" />
					)
				}
				leftActions={
					<div className="flex items-center gap-2">
						{showModeSelector && (
							<ProjectModeSelector
								value={projectMode}
								onChange={setProjectMode}
								modes={modeOptions}
							/>
						)}
						<ThinkModelPicker
							options={capabilities?.thinkModels ?? []}
							value={modelId}
							onChange={setModelId}
						/>
					</div>
				}
			/>

			<AnimatePresence mode="popLayout">
				{images.length > 0 && (
					<motion.div
						initial={{ opacity: 0, y: -10 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: -10 }}
						className="w-full mt-4"
					>
						<div
							className="flex items-start gap-2 px-4 py-3 rounded-xl bg-bg-4/50 dark:bg-bg-2/50 shadow-sm border-brand/20"
						>
							<InfoIcon
								className="size-4 flex-shrink-0 mt-0.5 text-brand"
							/>
							<p className="text-xs text-kumo-subtle leading-relaxed">
								<span className="font-medium text-text-secondary">
									Images Beta:
								</span>{' '}
								Images guide app layout and design but may
								not be replicated exactly. The coding agent
								cannot access images directly for app
								assets.
							</p>
						</div>
					</motion.div>
				)}
			</AnimatePresence>

			{/* Usage limit dialogs */}
			{showLimitDialog}
		</div>
	);
}
