import { useCallback, useEffect, useRef, useState } from 'react';
import { Banner, Button, Dialog, DialogClose, DialogDescription, DialogRoot, DialogTitle, Input, cn } from '@cloudflare/kumo';
import { CheckIcon, CopyIcon, WarningCircleIcon, XIcon } from '@phosphor-icons/react';
import { T, useI18n } from '@/lib/i18n';

const COPIED_FEEDBACK_MS = 1500;

interface ConfirmDeleteDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** What is being deleted, as the noun reads inside a sentence in the active language ("app", "API key", "clave de API"). */
	resourceType: string;
	/** The name the seller types to confirm, which is also shown as written. */
	resourceName: string;
	onDelete: () => void | Promise<void>;
	isDeleting?: boolean;
	/** Whether the typed name must match the resource name's capitals. */
	caseSensitive?: boolean;
	/** The delete button's text; by default "Delete {resourceType}". */
	deleteButtonText?: string;
	className?: string;
	/** Why the delete failed, shown above the warning. */
	errorMessage?: string;
	size?: 'sm' | 'base';
}

/**
 * Asks the seller to type a resource's name before it is deleted for good. It replaces Kumo's `DeleteResource`, whose
 * title, warning and buttons are fixed English text, and keeps its behavior.
 */
export function ConfirmDeleteDialog({
	open,
	onOpenChange,
	resourceType,
	resourceName,
	onDelete,
	isDeleting = false,
	caseSensitive = true,
	deleteButtonText,
	className,
	errorMessage,
	size = 'base',
}: ConfirmDeleteDialogProps) {
	const { t } = useI18n();
	const [confirmation, setConfirmation] = useState('');
	const [copied, setCopied] = useState(false);
	const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	useEffect(() => {
		if (!open) {
			setConfirmation('');
			setCopied(false);
		}
	}, [open]);

	useEffect(() => () => clearTimeout(copiedTimer.current), []);

	const normalize = (text: string) => (caseSensitive ? text : text.toLowerCase());
	const confirmed = normalize(confirmation) === normalize(resourceName);

	const handleDelete = useCallback(async () => {
		if (!confirmed || isDeleting) return;
		await onDelete();
	}, [confirmed, isDeleting, onDelete]);

	const handleCopy = useCallback(async () => {
		await navigator.clipboard.writeText(resourceName);
		setCopied(true);
		clearTimeout(copiedTimer.current);
		copiedTimer.current = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
	}, [resourceName]);

	return (
		<DialogRoot open={open} onOpenChange={onOpenChange}>
			<Dialog size={size} className={cn('p-0', className)}>
				<div className="flex items-center justify-between gap-2 border-b border-kumo-line px-6 py-4">
					<DialogTitle className="min-w-0 break-words text-lg font-semibold">{t('Delete {name}', { name: resourceName })}</DialogTitle>
					<DialogClose
						render={(props) => (
							<Button {...props} variant="ghost" shape="square" size="sm" aria-label={t('Close')} disabled={isDeleting}>
								<XIcon size={18} />
							</Button>
						)}
					/>
				</div>

				<div className="flex flex-col gap-4 p-6">
					<div className="flex flex-col gap-2">
						{errorMessage && (
							<Banner icon={<WarningCircleIcon />} variant="error">
								{errorMessage}
							</Banner>
						)}
						<DialogDescription className="max-w-prose text-base text-pretty text-kumo-subtle">
							<T
								text="This action cannot be undone. This will permanently delete the <name>{name}</name> {type}."
								values={{ name: resourceName, type: resourceType }}
								components={{ name: (children) => <span className="font-medium text-kumo-default">{children}</span> }}
							/>
						</DialogDescription>
					</div>

					<div className="flex flex-col gap-2">
						<div className="text-base">
							<T
								text="Type <name>{name}</name> to confirm:"
								values={{ name: resourceName }}
								components={{
									name: (children) => (
										<button
											type="button"
											className="group inline rounded-md bg-kumo-tint px-2 py-1 font-mono text-sm font-semibold hover:cursor-pointer hover:bg-kumo-fill"
											onClick={handleCopy}
											aria-label={t('Copy {name} to clipboard', { name: resourceName })}
										>
											{children}
											{copied ? (
												<CheckIcon size={12} weight="bold" className="ml-1.5 inline" />
											) : (
												<CopyIcon size={12} weight="bold" className="ml-1.5 inline text-kumo-subtle group-hover:text-kumo-default" />
											)}
										</button>
									),
								}}
							/>
						</div>
						<Input
							placeholder={resourceName}
							value={confirmation}
							onChange={(event) => setConfirmation(event.target.value)}
							disabled={isDeleting}
							autoComplete="off"
							autoCorrect="off"
							autoCapitalize="off"
							spellCheck={false}
							aria-label={t('Type {name} to confirm deletion', { name: resourceName })}
							className="w-full"
						/>
					</div>
				</div>

				<div className="flex flex-wrap justify-end gap-3 border-t border-kumo-line px-6 py-4">
					<DialogClose
						render={(props) => (
							<Button {...props} variant="secondary" disabled={isDeleting}>
								{t('Cancel')}
							</Button>
						)}
					/>
					<Button variant="destructive" onClick={handleDelete} disabled={!confirmed || isDeleting} loading={isDeleting}>
						{deleteButtonText ?? t('Delete {type}', { type: resourceType })}
					</Button>
				</div>
			</Dialog>
		</DialogRoot>
	);
}
