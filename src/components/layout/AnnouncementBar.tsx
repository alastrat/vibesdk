import { Link } from 'react-router';
import { PLATFORM_FEE_LABEL } from '@/api-types';
import { UNDERLINE_FILL } from '@/components/public-site/primitives';
import { ANNOUNCEMENT_POST, blogPostPath } from '@/content/blog';
import { cn } from '@/lib/utils';

/** Gold strip above the top bar, as on 1Password: the latest news on the left, and its blog post on the right. */
export function AnnouncementBar() {
	return (
		<div className="bg-public-gold text-public-charcoal">
			<div className="mx-auto flex h-11 max-w-[1248px] items-center justify-between gap-4 px-4 text-[13px] sm:px-6">
				<p className="flex min-w-0">
					<span className="truncate">Estori Discover is open: sell the stores you design and keep the price minus {PLATFORM_FEE_LABEL}.</span>
				</p>
				<Link to={blogPostPath(ANNOUNCEMENT_POST)} className={cn('shrink-0', UNDERLINE_FILL)}>
					Learn more →
				</Link>
			</div>
		</div>
	);
}
