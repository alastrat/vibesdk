import { Button } from '@/components/ui/button';
import type { ModelUnavailableNotice as Notice, ThinkModelOption } from '@/api-types';
import { describeCreditChange } from '@/utils/credit-change';

const PROVIDER_NAMES: Record<string, string> = {
	'google-ai-studio': 'Google',
	anthropic: 'Anthropic',
};

function reasonText(reason: Notice['reason'], provider: string): string {
	switch (reason) {
		case 'overloaded':
			return `${provider} reports high demand`;
		case 'rate_limited':
			return `${provider} rate limit or quota was reached`;
		case 'unavailable':
			return `${provider} returned an error`;
		case 'timeout':
			return `${provider} did not respond within 60 seconds`;
	}
}

interface ModelUnavailableNoticeProps {
	notice: Notice | null;
	options: ThinkModelOption[];
	onSwitch: (modelId: string) => void;
	onRetry: () => void;
	onDismiss: () => void;
}

/** Explains a build model provider failure and offers to switch or retry. */
export function ModelUnavailableNotice({ notice, options, onSwitch, onRetry, onDismiss }: ModelUnavailableNoticeProps) {
	if (!notice) return null;

	const failed = options.find((option) => option.id === notice.modelId);
	const alternative = options.find((option) => option.id === notice.alternativeModelId);
	const provider = PROVIDER_NAMES[failed?.provider ?? ''] ?? 'The provider';
	const status = notice.status ? ` (${notice.status})` : '';

	return (
		<div role="alert" className="mb-2 rounded-lg border border-kumo-line bg-kumo-elevated p-3 text-sm">
			<p className="font-medium text-kumo-strong">{failed?.label ?? notice.modelId} is unavailable</p>
			<p className="mt-1 text-kumo-subtle">
				{reasonText(notice.reason, provider)}
				{status}.
			</p>
			{notice.detail && <p className="mt-1 text-xs text-kumo-subtle">{notice.detail}</p>}
			<div className="mt-3 flex flex-wrap items-center gap-2">
				{alternative && (
					<Button size="sm" onClick={() => onSwitch(alternative.id)}>
						Switch to {alternative.label}
					</Button>
				)}
				<Button size="sm" variant="outline" onClick={onRetry}>
					Try again
				</Button>
				<Button size="sm" variant="ghost" onClick={onDismiss}>
					Dismiss
				</Button>
			</div>
			{alternative && failed && (
				<p className="mt-2 text-xs text-kumo-subtle">
					{alternative.label} uses {describeCreditChange(failed.creditCost, alternative.creditCost)}.
				</p>
			)}
		</div>
	);
}
