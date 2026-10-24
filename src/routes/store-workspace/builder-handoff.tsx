import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Button, Dialog } from '@cloudflare/kumo';
import { ArrowUpRightIcon, CopyIcon, XIcon } from '@phosphor-icons/react';
import { t, useI18n } from '@/lib/i18n';

/** Review the request before prefilling the existing builder. Sending remains an explicit composer action. */
export function BuilderHandoff({
	appId,
	request,
	label,
}: {
	appId: string;
	request: string;
	label: string;
}) {
	useI18n();
	const navigate = useNavigate();
	const [open, setOpen] = useState(false);
	const [draft, setDraft] = useState(request);
	const [copied, setCopied] = useState(false);
	const [error, setError] = useState(false);
	return (
		<>
			<Button
				variant="primary"
				size="sm"
				onClick={() => {
					setDraft(request);
					setCopied(false);
					setError(false);
					setOpen(true);
				}}
			>
				{label}
				<ArrowUpRightIcon size={14} />
			</Button>
			<Dialog.Root open={open} onOpenChange={setOpen}>
				<Dialog size="lg" className="p-6">
					<div className="flex items-start justify-between gap-4">
						<div>
							<Dialog.Title className="text-xl font-semibold">
								{t('Continue in your store builder')}
							</Dialog.Title>
							<Dialog.Description className="mt-2 text-sm text-kumo-subtle">
								{t(
									'Review this request, then open it in the builder. It will be ready in the message box for you to edit and send. Changes need to be published before shoppers see them.',
								)}
							</Dialog.Description>
						</div>
						<Dialog.Close
							render={(props) => (
								<Button
									{...props}
									variant="ghost"
									shape="square"
									aria-label={t('Close')}
								>
									<XIcon size={18} />
								</Button>
							)}
						/>
					</div>
					<label className="mt-5 grid gap-2 text-sm">
						<span>{t('Builder request')}</span>
						<textarea
							className="min-h-40 w-full resize-y rounded-lg border border-kumo-line bg-kumo-base p-3 text-sm"
							value={draft}
							maxLength={4000}
							onChange={(event) => {
								setDraft(event.target.value);
								setCopied(false);
							}}
						/>
					</label>
					{error && (
						<p
							role="alert"
							className="mt-2 text-sm text-kumo-danger"
						>
							{t(
								'Could not copy. Select the request above and copy it manually.',
							)}
						</p>
					)}
					<div className="mt-5 flex flex-wrap justify-end gap-2">
						<Button
							size="sm"
							variant="secondary"
							disabled={!draft.trim()}
							onClick={() => {
								void Promise.resolve()
									.then(() =>
										navigator.clipboard.writeText(draft),
									)
									.then(
										() => {
											setCopied(true);
											setError(false);
										},
										() => setError(true),
									);
							}}
						>
							<CopyIcon size={16} />
							{copied ? t('Copied') : t('Copy request')}
						</Button>
						<Button
							variant="primary"
							size="sm"
							disabled={!draft.trim() || draft.length > 4000}
							onClick={() =>
								navigate(`/chat/${encodeURIComponent(appId)}`, {
									state: {
										builderDraft: {
											source: 'store-workspace',
											appId,
											text: draft,
										},
									},
								})
							}
						>
							{t('Open in builder')}
							<ArrowUpRightIcon size={14} />
						</Button>
					</div>
				</Dialog>
			</Dialog.Root>
		</>
	);
}
