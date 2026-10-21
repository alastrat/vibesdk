import { useState, useMemo, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { type UsageSummary, type LimitConfig } from '@/hooks/use-limits';
import { CloudflareLogo } from './icons/logos';
import { CREDITS_BANNER_THRESHOLD } from '../../shared/constants/limits';
import { formatDollars, formatNumber } from '../../shared/i18n/format';
import { getLocale, t, useI18n } from '@/lib/i18n';

interface CreditsBannerProps {
	limitsData?: UsageSummary | null;
	onConnectCloudflare?: () => void;
	className?: string;
	children?: ReactNode;
	/** Border-radius (in px) of the encapsulated element — banner adds matching bottom padding so it tucks flush beneath it. */
	radius?: number;
}

function getResetDate(window: LimitWindow, periodSeconds?: number): Date | null {
	const now = new Date();
	switch (window) {
		case 'daily': {
			const d = new Date(now);
			d.setDate(d.getDate() + 1);
			d.setHours(0, 0, 0, 0);
			return d;
		}
		case 'weekly': {
			const d = new Date(now);
			const daysUntilMonday = (8 - d.getDay()) % 7 || 7;
			d.setDate(d.getDate() + daysUntilMonday);
			d.setHours(0, 0, 0, 0);
			return d;
		}
		case 'monthly':
			return new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
		case 'rolling':
			return periodSeconds ? new Date(now.getTime() + periodSeconds * 1000) : null;
		case 'lifetime':
		default:
			return null;
	}
}

/**
 * Money as a string: US dollars the way the language writes them ('$61.57', 'USD 61,57', 'US$ 61,57'), '€12.00' for
 * EUR, otherwise '12.00 XYZ'.
 */
function formatMoney(amount: number, currency: string): string {
	if (currency === 'USD') return formatDollars(amount, getLocale(), 'always');
	const symbols: Record<string, string> = { EUR: '€', GBP: '£' };
	const symbol = symbols[currency];
	const value = amount.toFixed(2);
	return symbol ? `${symbol}${value}` : `${value} ${currency}`;
}

function formatResetIn(target: Date): string {
	const diffMs = target.getTime() - Date.now();
	if (diffMs <= 0) return t('soon');
	const minutes = Math.floor(diffMs / 60000);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);
	if (days >= 1) return t('{count}d', { count: days });
	if (hours >= 1) return t('{count}h', { count: hours });
	return t('{count}m', { count: Math.max(1, minutes) });
}

type LimitWindow = 'daily' | 'weekly' | 'monthly' | 'lifetime' | 'rolling';

interface BannerInfo {
	content: ReactNode;
	isConnected: boolean;
}

/** Resolve the display reset date, preferring server-provided `resetAt`. */
function resolveResetDate(limit: LimitConfig): Date | null {
	return limit.resetAt
		? new Date(limit.resetAt)
		: getResetDate(limit.window as LimitWindow, limit.periodSeconds);
}

/**
 * Build the banner content for a Cloudflare-connected user whose free tier does not apply
 * (either unlimited plan or free tier exhausted). Renders the Cloudflare logo + gateway balance
 * when credits are known, otherwise a plain fallback string.
 */
function buildConnectedBalanceContent(
	credits: UsageSummary['cloudflareCredits'],
	resetDate: Date | null,
	fallback: string,
): ReactNode {
	const resetSuffix = resetDate ? ` · ${t('free credits reset in {time}', { time: formatResetIn(resetDate) })}` : '';
	if (!credits) {
		return `${fallback}${resetSuffix}`;
	}
	return (
		<span className="inline-flex items-center gap-1">
			<CloudflareLogo className="w-3.5 h-3.5" />
			<span>{formatMoney(credits.credits, credits.currency)} {resetSuffix}</span>
		</span>
	);
}

function useBannerInfo(limitsData?: UsageSummary | null): { bannerInfo: BannerInfo | null; dismiss: () => void } {
	const [isDismissed, setIsDismissed] = useState(false);
	const { t, tn, locale } = useI18n();

	const bannerInfo = useMemo<BannerInfo | null>(() => {
		// With billing on, the plan's credits and their warnings live on the billing page, not in a Cloudflare prompt.
		if (isDismissed || !limitsData || limitsData.billing) return null;
		const { config, usage, hasUserToken, hasCloudflareConfigured, cloudflareCredits } = limitsData;
		const isConnected = hasUserToken && hasCloudflareConfigured;

		// Unlimited access: for Cloudflare-connected users show their gateway balance + when free credits reset.
		if (config?.unlimited) {
			if (!isConnected) return null;
			if (cloudflareCredits && cloudflareCredits.credits >= CREDITS_BANNER_THRESHOLD) return null;
			const resetDate = config.limit ? resolveResetDate(config.limit) : null;
			return {
				content: buildConnectedBalanceContent(cloudflareCredits, resetDate, t('Connected to AI Gateway')),
				isConnected: true,
			};
		}

		const limit = config?.limit;
		if (!limit) return null;

		const current = usage[limit.type]?.[limit.window] || 0;
		const remaining = Math.max(0, limit.maxValue - current);
		const resetDate = resolveResetDate(limit);

		// Hide banner when remaining free credits are above the threshold
		if (remaining >= CREDITS_BANNER_THRESHOLD) return null;

		// Free tier exhausted: if connected, surface the gateway balance instead of '0 free credits remaining'.
		if (remaining <= 0 && isConnected) {
			if (cloudflareCredits && cloudflareCredits.credits >= CREDITS_BANNER_THRESHOLD) return null;
			return {
				content: buildConnectedBalanceContent(cloudflareCredits, resetDate, t('Free credits exhausted · using your AI Gateway')),
				isConnected: true,
			};
		}

		const amount = (() => {
			switch (limit.type) {
				case 'tokens': return `${(remaining / 1000).toFixed(0)}K`;
				case 'cost': return formatDollars(remaining, locale, 'always');
				default: return formatNumber(Math.round(remaining * 10) / 10, locale);
			}
		})();

		const remainingText = (() => {
			switch (limit.type) {
				case 'prompts': return tn('{amount} free prompt remaining', '{amount} free prompts remaining', remaining, { amount });
				case 'credits': return tn('{amount} free credit remaining', '{amount} free credits remaining', remaining, { amount });
				case 'tokens': return t('{amount} free tokens remaining', { amount });
				case 'cost': return t('{amount} of free credit remaining', { amount });
				default: return t('{amount} free remaining', { amount });
			}
		})();

		const resetText = resetDate
			? ` · ${limit.window === 'rolling' && !limit.resetAt ? t('resets within {time}', { time: formatResetIn(resetDate) }) : t('resets in {time}', { time: formatResetIn(resetDate) })}`
			: '';

		return {
			content: `${remainingText}${resetText}`,
			isConnected,
		};
	}, [limitsData, isDismissed, t, tn, locale]);

	return { bannerInfo, dismiss: () => setIsDismissed(true) };
}

export function CreditsBanner({ limitsData, onConnectCloudflare, className, children, radius = 12 }: CreditsBannerProps) {
	const { bannerInfo, dismiss } = useBannerInfo(limitsData);

	if (children) {
		return (
			<div className={`flex flex-col ${className ?? ''}`}>
				{bannerInfo && (
					<BannerContent
						bannerInfo={bannerInfo}
						onConnectCloudflare={onConnectCloudflare}
						onDismiss={dismiss}
						style={{ paddingBottom: radius + 6, marginBottom: -radius, borderTopLeftRadius: radius, borderTopRightRadius: radius, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}
					/>
				)}
				{children}
			</div>
		);
	}

	if (!bannerInfo) return null;

	return (
		<BannerContent
			bannerInfo={bannerInfo}
			onConnectCloudflare={onConnectCloudflare}
			onDismiss={dismiss}
			className={className}
		/>
	);
}

function BannerContent({
	bannerInfo,
	onConnectCloudflare,
	onDismiss,
	className,
	style,
}: {
	bannerInfo: BannerInfo;
	onConnectCloudflare?: () => void;
	onDismiss: () => void;
	className?: string;
	style?: React.CSSProperties;
}) {
	return (
		<div
			style={style}
			className={`flex items-center justify-between px-3 py-1.5 bg-kumo-elevated border border-brand-primary/30 shadow-md ${style?.borderTopLeftRadius !== undefined ? '' : 'rounded-lg'} ${className ?? ''}`}
		>
			<span className="text-xs font-medium text-kumo-brand-primary">
				{bannerInfo.content}
			</span>
			<div className="flex items-center gap-1.5">
				{!bannerInfo.isConnected && (
					<button
						type="button"
						onClick={onConnectCloudflare}
						className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-sm text-white bg-brand/25 hover:bg-brand transition-colors duration-200"
					>
						<CloudflareLogo className="w-3.5 h-3.5" color1="#fff" color2="#fff" />
						{t('Connect')}
					</button>
				)}
				<button
					type="button"
					onClick={onDismiss}
					className="p-0.5 rounded hover:bg-kumo-base text-kumo-subtle hover:text-text-primary transition-colors"
				>
					<X className="size-3.5" />
				</button>
			</div>
		</div>
	);
}
