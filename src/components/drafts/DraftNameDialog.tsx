import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@cloudflare/kumo';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { DRAFT_NAME_MAX_LENGTH, type DraftStart, type DraftSummary } from '@/api-types';
import { useCreateDraft, useRenameDraft } from '@/hooks/use-drafts';

interface DraftNameDialogProps {
	appId: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Renames this draft; without it, the dialog starts a new one. */
	draft?: DraftSummary;
	/** A quick fix needs a live store to start from. */
	published: boolean;
}

export function DraftNameDialog({ appId, open, onOpenChange, draft, published }: DraftNameDialogProps) {
	const create = useCreateDraft(appId);
	const rename = useRenameDraft(appId);
	const [name, setName] = useState(draft?.name ?? '');
	const [from, setFrom] = useState<DraftStart>('main');
	useEffect(() => {
		if (open) {
			setName(draft?.name ?? '');
			setFrom('main');
		}
	}, [open, draft?.name]);

	const pending = create.isPending || rename.isPending;
	const done = () => onOpenChange(false);
	const onError = (error: Error) => toast.error(error.message);
	const onSubmit = (event: React.FormEvent) => {
		event.preventDefault();
		if (draft) rename.mutate({ draftId: draft.id, name }, { onSuccess: done, onError });
		else create.mutate({ name, from }, { onSuccess: done, onError });
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{draft ? 'Rename draft' : 'New draft'}</DialogTitle>
					<DialogDescription>
						{draft ? 'Only the name changes.' : 'A draft is a version of your store with its own preview. Nothing reaches shoppers until you publish it.'}
					</DialogDescription>
				</DialogHeader>
				<form className="grid gap-4" onSubmit={onSubmit}>
					<Input aria-label="Name" value={name} maxLength={DRAFT_NAME_MAX_LENGTH} onChange={(event) => setName(event.target.value)} placeholder="Spring sale" autoFocus />
					{!draft && (
						<fieldset className="grid gap-2">
							<legend className="text-sm font-medium">Start from</legend>
							<RadioGroup value={from} onValueChange={(value) => setFrom(value === 'live' ? 'live' : 'main')}>
								<label className="flex items-center gap-2 text-sm">
									<RadioGroupItem value="main" /> Main
								</label>
								<label className={published ? 'flex items-center gap-2 text-sm' : 'flex items-center gap-2 text-sm text-kumo-subtle'}>
									<RadioGroupItem value="live" disabled={!published} /> The live store (quick fix)
								</label>
							</RadioGroup>
							{!published && <p className="text-sm text-kumo-subtle">Publish your store to start a quick fix from it.</p>}
						</fieldset>
					)}
					<div className="flex justify-end gap-2">
						<Button type="button" variant="secondary" size="sm" onClick={done}>
							Cancel
						</Button>
						<Button type="submit" variant="primary" size="sm" disabled={name.trim() === '' || pending} loading={pending}>
							{draft ? 'Rename' : 'Start draft'}
						</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}
