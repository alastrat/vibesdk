import { useState } from 'react';
import { Link } from 'react-router';
import { buttonVariants } from '@cloudflare/kumo';
import { InfoIcon, WarningCircleIcon, XIcon } from '@phosphor-icons/react';
import { useBilling } from '@/hooks/use-billing';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { bannerKeyFor, billingBannerFor, type BillingBanner as Notice } from '@/routes/settings/billing-view';
import { PlanButton } from './PlanButton';

const TONES: Record<Notice['tone'], string> = {
	warning: 'bg-kumo-warning-tint text-kumo-warning',
	info: 'bg-kumo-info-tint text-kumo-info',
};

function wasDismissed(key: string): boolean {
	try {
		return sessionStorage.getItem(key) !== null;
	} catch {
		return false;
	}
}

function rememberDismissed(key: string): void {
	try {
		sessionStorage.setItem(key, '1');
	} catch {
		// Without storage the banner only stays closed until the next page load.
	}
}

function NoticeAction({ action }: { action: Notice['action'] }) {
	switch (action.kind) {
		case 'checkout':
			return <PlanButton plan={action.plan} variant="blue" className="px-3 py-1 text-xs" />;
		case 'link':
			return (
				<Link to={action.to} className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}>
					{action.label}
				</Link>
			);
		case 'none':
			return null;
	}
}

/** A failed payment or a credits warning above every app page, until the seller closes it for the session. */
export function BillingBanner() {
	const billing = useBilling();
	const view = billing.data;
	const notice = billingBannerFor(view);
	const [closed, setClosed] = useState<string | null>(null);
	if (!view || !notice) return null;
	const key = bannerKeyFor(view);
	if (closed === key || wasDismissed(key)) return null;
	const Glyph = notice.tone === 'warning' ? WarningCircleIcon : InfoIcon;

	return (
		<div role="status" className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-kumo-line px-4 py-2 text-sm', TONES[notice.tone])}>
			<Glyph weight="fill" className="size-4 shrink-0" aria-hidden />
			<p className="min-w-0 flex-1">{notice.message}</p>
			<div className="flex items-center gap-2">
				<NoticeAction action={notice.action} />
				<button
					type="button"
					aria-label={t('Close')}
					onClick={() => {
						rememberDismissed(key);
						setClosed(key);
					}}
					className="rounded p-1 transition-colors hover:bg-kumo-tint"
				>
					<XIcon className="size-3.5" aria-hidden />
				</button>
			</div>
		</div>
	);
}
