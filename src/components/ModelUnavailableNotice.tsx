import { Button } from '@/components/ui/button';
import type { ModelUnavailableNotice as Notice, ThinkModelOption } from '@/api-types';
import { tn, t } from '@/lib/i18n';
import { describeCreditChange } from '@/utils/credit-change';
import { MODEL_RESPONSE_TIMEOUT_MS } from '../../shared/think';

const PROVIDER_NAMES: Record<string, string> = {
	'google-ai-studio': 'Google',
	anthropic: 'Anthropic',
};

function reasonText(reason: Notice['reason'], provider: string): string {
	switch (reason) {
		case 'overloaded':
			return t('{provider} reports high demand', { provider });
		case 'rate_limited':
			return t('{provider} rate limit or quota was reached', { provider });
		case 'unavailable':
			return t('{provider} returned an error', { provider });
		case 'timeout':
			return tn('{provider} did not respond within {count} second', '{provider} did not respond within {count} seconds', Math.round(MODEL_RESPONSE_TIMEOUT_MS / 1000), { provider });
	}
}

interface ModelUnavailableNoticeProps {
	notice: Notice | null;
	options: ThinkModelOption[];
	onSwitch: (modelId: string) => void;
	onRetry: () => void;
	onDismiss: () => void;
	/** Disables the actions that need the agent socket. */
	disabled?: boolean;
}

/** Explains a build model provider failure and offers to switch or retry. */
export function ModelUnavailableNotice({ notice, options, onSwitch, onRetry, onDismiss, disabled = false }: ModelUnavailableNoticeProps) {
	if (!notice) return null;

	const failed = options.find((option) => option.id === notice.modelId);
	const alternative = options.find((option) => option.id === notice.alternativeModelId);
	const provider = PROVIDER_NAMES[failed?.provider ?? ''] ?? t('The provider');
	const status = notice.status ? ` (${notice.status})` : '';

	return (
		<div role="alert" className="mb-2 rounded-lg border border-kumo-line bg-kumo-elevated p-3 text-sm">
			<p className="font-medium text-kumo-strong">{t('{model} is unavailable', { model: failed?.label ?? notice.modelId })}</p>
			<p className="mt-1 text-kumo-subtle">
				{reasonText(notice.reason, provider)}
				{status}.
			</p>
			{notice.detail && <p className="mt-1 text-xs text-kumo-subtle">{notice.detail}</p>}
			<div className="mt-3 flex flex-wrap items-center gap-2">
				{alternative && (
					<Button size="sm" disabled={disabled} onClick={() => onSwitch(alternative.id)}>
						{t('Switch to {model}', { model: alternative.label })}
					</Button>
				)}
				<Button size="sm" variant="outline" disabled={disabled} onClick={onRetry}>
					{t('Try again')}
				</Button>
				<Button size="sm" variant="ghost" onClick={onDismiss}>
					{t('Dismiss')}
				</Button>
			</div>
			{alternative && failed && (
				<p className="mt-2 text-xs text-kumo-subtle">
					{t('{model} uses {change}.', { model: alternative.label, change: describeCreditChange(failed.creditsPerStep, alternative.creditsPerStep) })}
				</p>
			)}
		</div>
	);
}
