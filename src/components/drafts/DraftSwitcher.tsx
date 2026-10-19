import { useState } from 'react';
import { toast } from 'sonner';
import { Badge, Button } from '@cloudflare/kumo';
import { CaretDown, Check } from '@phosphor-icons/react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ConfirmButton } from '@/components/confirm-button';
import { MAIN_DRAFT_ID, type DraftSummary } from '@/api-types';
import { useActivateDraft, useDeleteDraft, useDrafts } from '@/hooks/use-drafts';
import { bringInRequest, canDeleteDraft, draftBadges } from './draft-view';
import { DraftNameDialog } from './DraftNameDialog';

interface DraftSwitcherProps {
	appId: string;
	/** Changes whenever the preview reloads, so states follow deploys and switches. */
	refreshKey: string | undefined;
	isGenerating: boolean;
	/** Sends a chat request to the AI, as if the seller typed it. */
	onSendMessage: (message: string) => void;
}

function Badges({ draft }: { draft: DraftSummary }) {
	return (
		<>
			{draftBadges(draft).map((badge) => (
				<Badge key={badge.label} variant={badge.variant}>
					{badge.label}
				</Badge>
			))}
		</>
	);
}

export function DraftSwitcher({ appId, refreshKey, isGenerating, onSendMessage }: DraftSwitcherProps) {
	const drafts = useDrafts(appId, true, refreshKey);
	const activate = useActivateDraft(appId);
	const remove = useDeleteDraft(appId);
	const [open, setOpen] = useState(false);
	const [naming, setNaming] = useState<{ draft?: DraftSummary } | null>(null);

	const snapshot = drafts.data;
	const active = snapshot?.drafts.find((draft) => draft.active) ?? snapshot?.drafts[0];
	if (!snapshot || !active) return null;
	const atLimit = snapshot.drafts.length >= snapshot.limit;
	const onError = (error: Error) => toast.error(error.message);
	const switchTo = (draft: DraftSummary) => {
		setOpen(false);
		activate.mutate(draft.id, { onError });
	};
	const bringIn = (draft: DraftSummary) => {
		setOpen(false);
		onSendMessage(bringInRequest(draft.name));
	};
	const startNaming = (draft?: DraftSummary) => {
		setOpen(false);
		setNaming({ draft });
	};

	return (
		<>
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<button type="button" className="flex min-w-0 items-center gap-1.5 rounded px-1.5 py-0.5 text-sm hover:bg-kumo-elevated" title="Drafts">
						<span className="truncate font-medium">{active.name}</span>
						<Badges draft={active} />
						<CaretDown className="size-3.5 shrink-0 text-text-primary/50" />
					</button>
				</PopoverTrigger>
				<PopoverContent align="start" className="grid w-80 gap-2 p-2">
					{snapshot.drafts.map((draft) => (
						<div key={draft.id} className="grid gap-1 rounded p-2 hover:bg-kumo-elevated">
							<button type="button" className="flex items-center gap-2 text-left text-sm" onClick={() => switchTo(draft)} disabled={draft.active || isGenerating || activate.isPending}>
								{draft.active ? <Check className="size-4 shrink-0" /> : <span className="size-4 shrink-0" />}
								<span className="truncate font-medium">{draft.name}</span>
								<Badges draft={draft} />
							</button>
							<div className="flex flex-wrap items-center gap-2 pl-6 text-xs text-kumo-subtle">
								<span>Changed {new Date(draft.updatedAt).toLocaleString()}</span>
								{draft.behindLive && !draft.bringingInLiveChanges && (
									<Button variant="ghost" size="sm" onClick={() => bringIn(draft)}>
										Bring in live changes
									</Button>
								)}
								{draft.id !== MAIN_DRAFT_ID && (
									<Button variant="ghost" size="sm" onClick={() => startNaming(draft)}>
										Rename
									</Button>
								)}
								{canDeleteDraft(draft) && (
									<ConfirmButton
										variant="ghost"
										label="Delete"
										title={`Delete '${draft.name}'?`}
										description="Its preview is removed. Its earlier versions stay in the store's history."
										pending={remove.isPending}
										onConfirm={() => remove.mutate(draft.id, { onError })}
									/>
								)}
							</div>
						</div>
					))}
					{isGenerating && <p className="px-2 text-xs text-kumo-subtle">Wait for the AI to finish, then switch drafts.</p>}
					<Button variant="secondary" size="sm" onClick={() => startNaming()} disabled={atLimit || isGenerating}>
						New draft
					</Button>
					{atLimit && <p className="px-2 text-xs text-kumo-subtle">Delete a draft to start a new one.</p>}
				</PopoverContent>
			</Popover>
			<DraftNameDialog appId={appId} open={naming !== null} onOpenChange={(next) => !next && setNaming(null)} draft={naming?.draft} published={snapshot.published} />
		</>
	);
}
