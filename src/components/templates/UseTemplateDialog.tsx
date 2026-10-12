import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Button, InputArea } from '@cloudflare/kumo';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { ThinkModelPicker } from '@/components/ThinkModelPicker';
import { useFeature } from '@/features';
import { MAX_AGENT_QUERY_LENGTH, type PublicTemplateDetail } from '@/api-types';
import { templateStartPath } from '@/lib/template-start';

interface UseTemplateDialogProps {
	template: PublicTemplateDetail;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function UseTemplateDialog({ template, open, onOpenChange }: UseTemplateDialogProps) {
	const navigate = useNavigate();
	const { capabilities } = useFeature();
	const [description, setDescription] = useState('');
	const [modelId, setModelId] = useState('');
	const effectiveModel = modelId || capabilities?.defaultThinkModel || '';

	const start = () => {
		onOpenChange(false);
		navigate(
			templateStartPath({ templateId: template.id, description, modelId: effectiveModel || undefined }),
			{ state: { fromPrompt: true } },
		);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Use {template.name}</DialogTitle>
					<DialogDescription>
						Your new app starts as a copy of this template. Describe your business and the agent rewrites the
						text, names, prices and images for you, or leave it empty to keep an exact copy.
					</DialogDescription>
				</DialogHeader>
				<InputArea
					id="template-description"
					label="Describe your business (optional)"
					placeholder="A family bakery in Lisbon that sells sourdough and pastries"
					value={description}
					maxLength={MAX_AGENT_QUERY_LENGTH}
					onChange={(event) => setDescription(event.target.value)}
				/>
				<div className="flex items-center justify-between gap-2">
					<ThinkModelPicker
						options={capabilities?.thinkModels ?? []}
						value={effectiveModel}
						onChange={setModelId}
					/>
					<Button variant="primary" onClick={start}>
						Start building
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
