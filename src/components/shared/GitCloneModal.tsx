import { useState, useEffect, type ReactNode } from 'react';
import {
	Banner,
	Button,
	Dialog,
	DialogClose,
	DialogDescription,
	DialogRoot,
	DialogTitle,
	cn,
	useKumoToastManager,
} from '@cloudflare/kumo';
import { CodeHighlighted, ShikiProvider } from '@cloudflare/kumo/code';
import {
	EyeIcon,
	EyeSlashIcon,
	GitBranchIcon,
	WarningCircleIcon,
	XIcon,
	ClockIcon,
} from '@phosphor-icons/react';
import { apiClient } from '@/lib/api-client';
import { T, t } from '@/lib/i18n';
import { normalizeAppTitle } from '@/utils/string';
import type { GitCloneTokenData } from '@/api-types';

interface GitCloneModalProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	appId: string;
	appTitle: string;
	isPublic: boolean;
	isOwner: boolean;
}

function CodeCommandBlock({
	code,
	label,
	blurred = false,
	onReveal,
	headerAction,
}: {
	code: string;
	label: string;
	blurred?: boolean;
	onReveal?: () => void;
	headerAction?: ReactNode;
}) {
	return (
		<div className="grid gap-2">
			<div className="flex items-center justify-between gap-2">
				<span className="text-sm font-medium text-kumo-default">
					{label}
				</span>
				{headerAction}
			</div>
			<div className="relative min-w-0 overflow-hidden rounded-lg ring ring-kumo-line">
				<div className={cn(blurred && 'blur-sm select-none')}>
					<CodeHighlighted
						code={code}
						lang="bash"
						showCopyButton={!blurred}
					/>
				</div>
				{blurred && onReveal && (
					<button
						type="button"
						onClick={onReveal}
						className="absolute inset-0 flex items-center justify-center rounded-lg bg-kumo-base/80 backdrop-blur-sm"
					>
						<span className="inline-flex items-center gap-2 text-sm font-medium text-kumo-default">
							<EyeIcon className="size-4" weight="duotone" />
							{t('Click to reveal token')}
						</span>
					</button>
				)}
			</div>
		</div>
	);
}

/** Minutes and seconds left, such as "12m 30s". */
function formatRemaining(ms: number): string {
	const minutes = Math.floor(ms / 60000);
	const seconds = Math.floor((ms % 60000) / 1000);
	return t('{minutes}m {seconds}s', { minutes, seconds });
}

export function GitCloneModal({
	open,
	onOpenChange,
	appId,
	appTitle,
	isPublic,
}: GitCloneModalProps) {
	const toast = useKumoToastManager();
	const [tokenData, setTokenData] = useState<GitCloneTokenData | null>(null);
	const [isGenerating, setIsGenerating] = useState(false);
	const [tokenRevealed, setTokenRevealed] = useState(false);
	/** Milliseconds until the token expires; null before one is generated. */
	const [remainingMs, setRemainingMs] = useState<number | null>(null);

	const host = window.location.host;
	const protocol =
		host.startsWith('localhost') || host.startsWith('127.0.0.1')
			? 'http'
			: 'https';
	const publicCloneUrl = `${protocol}://${host}/apps/${appId}.git`;

	useEffect(() => {
		if (!open) {
			setTokenData(null);
			setIsGenerating(false);
			setTokenRevealed(false);
			setRemainingMs(null);
		}
	}, [open]);

	useEffect(() => {
		if (!tokenData?.expiresAt) return;

		const interval = setInterval(() => {
			const expiresAt = new Date(tokenData.expiresAt).getTime();
			const diff = expiresAt - Date.now();

			setRemainingMs(Math.max(diff, 0));
				if (diff <= 0) clearInterval(interval);
		}, 1000);

		return () => clearInterval(interval);
	}, [tokenData?.expiresAt]);

	const handleGenerateToken = async () => {
		setIsGenerating(true);
		try {
			const response = await apiClient.generateGitCloneToken(appId);
			if (response.data) {
				setTokenData(response.data);
				setTokenRevealed(false);
				toast.add({
					title: t('Token generated successfully'),
					variant: 'success',
				});
			}
		} catch (error) {
			console.error('Failed to generate token:', error);
			toast.add({
				title: t('Failed to generate token'),
				variant: 'error',
			});
		} finally {
			setIsGenerating(false);
		}
	};

	const normalizedTitle = normalizeAppTitle(appTitle);

	const gitCloneCommand = isPublic
		? `git clone ${publicCloneUrl} ${normalizedTitle}`
		: tokenData
			? `git clone ${tokenData.cloneUrl} ${normalizedTitle}`
			: '';

	const setupCommands = `cd ${normalizedTitle}\nbun install\nbun run dev`;

	return (
		<DialogRoot open={open} onOpenChange={onOpenChange}>
			<Dialog size="lg" className="p-0 sm:w-[32rem]">
				<div className="flex items-center justify-between border-b border-kumo-line px-6 py-4">
					<div className="grid min-w-0 gap-1">
						<DialogTitle className="flex items-center gap-2 text-lg font-semibold">
							<span className="h-lh flex items-center">
								<GitBranchIcon
									className="size-5 text-kumo-brand"
									weight="duotone"
								/>
							</span>
							{t('Clone repository')}
						</DialogTitle>
						<DialogDescription className="text-sm text-kumo-subtle">
							{isPublic
								? t('Clone this app to your local machine')
								: t('Generate a temporary access token to clone this private repository')}
						</DialogDescription>
					</div>
					<DialogClose
						render={(props) => (
							<Button
								{...props}
								variant="ghost"
								shape="square"
								size="sm"
								aria-label={t('Close')}
							>
								<XIcon className="size-4.5" />
							</Button>
						)}
					/>
				</div>

				<div className="grid gap-4 p-6">
					<ShikiProvider engine="javascript" languages={['bash']}>
						{isPublic ? (
							<>
								<CodeCommandBlock
									label={t('Clone command')}
									code={gitCloneCommand}
								/>
								<CodeCommandBlock
									label={t('Quick start')}
									code={setupCommands}
								/>
							</>
						) : !tokenData ? (
							<div className="grid gap-4">
								<Banner
									icon={<WarningCircleIcon />}
									description={t('Generate a temporary access token to clone this private repository. The token expires in 1 hour.')}
								/>

								<div className="flex w-full">
									<Button
										variant="primary"
										className="self-end ml-auto"
										onClick={() => {
											void handleGenerateToken();
										}}
										disabled={isGenerating}
										loading={isGenerating}
										icon={
											!isGenerating ? (
												<GitBranchIcon
													className="size-4"
													weight="duotone"
												/>
											) : undefined
										}
									>
										{isGenerating
											? t('Generating token...')
											: t('Generate clone token')}
									</Button>
								</div>
							</div>
						) : (
							<>
								<CodeCommandBlock
									label={t('Clone command')}
									code={gitCloneCommand}
									blurred={!tokenRevealed}
									onReveal={() => setTokenRevealed(true)}
									headerAction={
										<Button
											variant="ghost"
											size="sm"
											shape="square"
											aria-label={
												tokenRevealed
													? t('Hide token')
													: t('Reveal token')
											}
											onClick={() =>
												setTokenRevealed(
													(prev) => !prev,
												)
											}
											icon={
												tokenRevealed ? (
													<EyeSlashIcon className="size-4" />
												) : (
													<EyeIcon className="size-4" />
												)
											}
										/>
									}
								/>

								<div className="flex items-center gap-2 rounded-lg bg-kumo-recessed px-3 py-2.5 ring ring-kumo-line">
									<span className="h-lh flex items-center">
										<ClockIcon
											weight="duotone"
											className="size-4 text-kumo-subtle"
										/>
									</span>
									<span className="text-sm text-kumo-subtle">
										{remainingMs !== null && remainingMs <= 0 ? (
											t('Expired')
										) : (
											<T
												text="Token expires in <time>{time}</time>"
												values={{ time: remainingMs === null ? '' : formatRemaining(remainingMs) }}
												components={{ time: (children) => <span className="font-medium text-kumo-default tabular-nums">{children}</span> }}
											/>
										)}
									</span>
								</div>

								<CodeCommandBlock
									label={t('Quick start')}
									code={setupCommands}
								/>

								<Button
									variant="secondary"
									onClick={() => {
										void handleGenerateToken();
									}}
									disabled={isGenerating}
									loading={isGenerating}
								>
									{isGenerating
										? t('Generating...')
										: t('Generate new token')}
								</Button>
							</>
						)}
					</ShikiProvider>
				</div>
			</Dialog>
		</DialogRoot>
	);
}
