import { t } from '@/lib/i18n';
import { marketingCopy } from '@/content/marketing-copy';
import { Link } from 'react-router';
import { PLATFORM_FEE_LABEL } from '@/api-types';
import { UNDERLINE_FILL } from '@/components/public-site/primitives';
import { ANNOUNCEMENT_POST, blogPostPath } from '@/content/blog';
import { cn } from '@/lib/utils';

/**
 * Gold strip above the top bar, as on 1Password: the latest news, centred on wide screens, and its blog post on the
 * right. Narrower screens keep the news left-aligned, where it truncates.
 */
export function AnnouncementBar() {
	return (
		<div className="bg-public-gold text-public-charcoal">
			<div className="mx-auto grid h-11 max-w-[1296px] grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 text-[13px] sm:px-6 lg:grid-cols-[1fr_minmax(0,auto)_1fr]">
				{/* Balances Learn more, so the news sits in the middle of the strip. */}
				<span aria-hidden className="hidden lg:block" />
				<p className="flex min-w-0 lg:justify-center">
					<span className="truncate">{t(marketingCopy.navigation.announcement.text, { platformFee: PLATFORM_FEE_LABEL })}</span>
				</p>
				<Link to={blogPostPath(ANNOUNCEMENT_POST)} className={cn('shrink-0 justify-self-end', UNDERLINE_FILL)}>
					{t(marketingCopy.navigation.announcement.link)}</Link>
			</div>
		</div>
	);
}
