/**
 * Combined Cloudflare Connect Button with Usage Badge
 * Shows Cloudflare connect button with attached usage indicator
 */

import { useLimitsContext } from '@/contexts/limits-context';
import type { LimitConfig, UsageSummary } from '@/hooks/use-limits';
import { formatCredits } from '@/api-types';
import { t, tn, useI18n } from '@/lib/i18n';
import { formatDollars } from '../../shared/i18n/format';
import { formatLimitAmount } from '@/lib/limit-amount';
import { Loader2, LucideGlobeLock } from 'lucide-react';

interface UsageLimitsBadgeProps {
	onConnect: () => void;
}

export interface UsageLimitsBadgeState {
	data: UsageSummary | null;
	loading: boolean;
	error: string | null;
	hidden: boolean;
	usageText: string;
	mobileUsageText: string;
	isExhausted: boolean;
	hasUserToken: boolean;
	showCredits: boolean;
	creditsText: string;
	needsConfiguration: boolean;
	showUsage: boolean;
	/** Billing is on for the account: the limit is its plan's credits, with no Cloudflare account to connect. */
	billing: boolean;
}

/** What is left of a plan's credits, which are not all free. */
function billingUsageText(type: LimitConfig['type'], remaining: number, amount: string): string {
	switch (type) {
		case 'prompts':
			return tn('{amount} prompt left', '{amount} prompts left', remaining, { amount });
		case 'tokens':
			return t('{amount} tokens left', { amount });
		case 'credits':
			return tn('{amount} credit left', '{amount} credits left', remaining, { amount });
		case 'cost':
			return t('{amount} left', { amount });
	}
}

/** What is left of the free allowance. */
function freeUsageText(type: LimitConfig['type'], remaining: number, amount: string): string {
	switch (type) {
		case 'prompts':
			return tn('{amount} free prompt left', '{amount} free prompts left', remaining, { amount });
		case 'tokens':
			return t('{amount} free tokens left', { amount });
		case 'credits':
			return tn('{amount} free credit left', '{amount} free credits left', remaining, { amount });
		case 'cost':
			return t('{amount} free left', { amount });
	}
}

/** The short form for narrow screens. */
function mobileUsageLabel(type: LimitConfig['type'], remaining: number, amount: string): string {
	switch (type) {
		case 'prompts':
			return tn('{amount} prompt', '{amount} prompts', remaining, { amount });
		case 'tokens':
			return t('{amount} tokens', { amount });
		case 'credits':
			return tn('{amount} credit', '{amount} credits', remaining, { amount });
		case 'cost':
			return amount;
	}
}

// eslint-disable-next-line react-refresh/only-export-components -- Shared with the sidebar menu to reuse the badge's exact derived state.
export function useUsageLimitsBadgeState(): UsageLimitsBadgeState {
	const { data, loading, error } = useLimitsContext();
	const { locale } = useI18n();

	// Get usage info
	let usageText = '';
	let mobileUsageText = '';
	let isExhausted = false;
	let hasUserToken = false;
	let showCredits = false;
	let creditsText = '';
	let needsConfiguration = false;
	let showUsage = false;
	const billing = Boolean(data?.billing);
	// With billing on, everyone sees the credits left.
	const hidden = !loading && Boolean(data && !data.cloudflareConnectEnabled && !data.billing);

	if (!hidden && !loading && !error && data && data.config) {
		const {
			config,
			usage,
			limitCheck,
			hasUserToken: userHasToken,
			hasCloudflareConfigured,
			cloudflareCredits
		} = data;
		const limit = config.limit;
		hasUserToken = userHasToken;

		// If user has token but hasn't configured account/gateway
		if (hasUserToken && !hasCloudflareConfigured) {
			needsConfiguration = true;
		}

		// Backend indicates both that the OAuth cookie is present and an
		// account/gateway is configured; safe to show the credit balance.
		if (hasUserToken && hasCloudflareConfigured && cloudflareCredits) {
			showCredits = true;
			const creditsAmount = formatDollars(cloudflareCredits.credits, locale, 'always');
			creditsText = cloudflareCredits.gatewayName
				? `${creditsAmount} (${cloudflareCredits.gatewayName})`
				: t('{amount} credits', { amount: creditsAmount });
		}

		if (limit && !config.unlimited) {
			const current = usage[limit.type]?.[limit.window] || 0;
			const max = limit.maxValue;
			const remaining = Math.max(0, max - current);
			isExhausted = !limitCheck.withinLimits;

			// A plan's credits aren't all free, so billing drops the word.
			const amount = billing ? formatCredits(remaining, locale) : formatLimitAmount(limit.type, remaining, locale);
			usageText = billing ? billingUsageText(limit.type, remaining, amount) : freeUsageText(limit.type, remaining, amount);
			mobileUsageText = mobileUsageLabel(limit.type, remaining, amount);
			showUsage = true;
		}
	}

	return {
		data,
		loading,
		error,
		hidden,
		usageText,
		mobileUsageText,
		isExhausted,
		hasUserToken,
		showCredits,
		creditsText,
		needsConfiguration,
		showUsage,
		billing,
	};
}

export function UsageLimitsBadge({ onConnect }: UsageLimitsBadgeProps) {
	const {
		loading,
		hidden,
		usageText,
		mobileUsageText,
		isExhausted,
		hasUserToken,
		showCredits,
		creditsText,
		needsConfiguration,
		showUsage,
	} = useUsageLimitsBadgeState();

	if (hidden) {
		return null;
	}

	return (
		<>
			<button
				type="button"
				className="inline-flex items-center rounded-md text-xs overflow-hidden hover:opacity-80"
				onClick={needsConfiguration || showCredits ? () => window.location.href = '/settings' : onConnect}
			>
				{/* Loading state */}
				{loading && (
					<div className="flex items-center px-2 py-1">
						<Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
					</div>
				)}

				{/* Usage badge - on the LEFT */}
				{!loading && showUsage && !isExhausted && (
					<div className="flex items-center px-2 py-1 text-text-primary font-medium">
						<span className="hidden md:inline">{usageText}</span>
						<span className="md:hidden">{mobileUsageText}</span>
					</div>
				)}

				{/* Red badge when exhausted and no token */}
				{!loading && isExhausted && !hasUserToken && (
					<div className="flex items-center px-2 py-1 bg-gradient-to-r from-red-600 to-red-500 text-white border-r border-red-500/30 font-medium">
						<span className="hidden md:inline">{t('Free limit exhausted')}</span>
						<span className="md:hidden">{t('Exhausted')}</span>
					</div>
				)}

				{/* Connect button / Credits display - on the RIGHT */}
				<div className="flex items-center gap-1.5 px-2 py-1 text-white bg-brand rounded-md">
					{!showCredits && <LucideGlobeLock className="w-3 h-3" />}
					{loading ? (
						<span className="hidden sm:inline text-muted-foreground">{t('Loading...')}</span>
					) : needsConfiguration ? (
						<span className="hidden sm:inline font-medium text-amber-500">{t('Configure AI Gateway')}</span>
					) : showCredits ? (
						<span className="hidden sm:inline font-medium">{creditsText}</span>
					) : (
						<span>{t('Connect')}</span>
					)}
				</div>
			</button>
		</>
	);
}
