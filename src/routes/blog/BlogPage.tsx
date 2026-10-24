import { t } from '@/lib/i18n';
import { Link, useSearchParams } from 'react-router';
import { FeaturedPost, PostCard, PostListItem } from '@/components/blog/BlogCards';
import { UNDERLINE_FILL } from '@/components/public-site/primitives';
import { PageMeta } from '@/components/public-site/solution-page';
import { BLOG_CATEGORIES, postsInCategory } from '@/content/blog';
import { BLOG_PAGE } from '@/content/public-pages';
import { cn } from '@/lib/utils';

/** How many posts sit beside the featured one before the grid starts. */
const SIDE_POSTS = 4;

/** 1Password's blog index: a centred title, category links, the newest post featured beside the next few, then the rest. */
export default function BlogPage() {
	const [params] = useSearchParams();
	const category = BLOG_CATEGORIES.find((entry) => entry.id === params.get('category'))?.id ?? null;
	const posts = postsInCategory(category);
	const [featured, ...others] = posts;
	const beside = others.slice(0, SIDE_POSTS);
	const latest = others.slice(SIDE_POSTS);

	return (
		<div className="bg-white px-4 pt-16 pb-24 sm:px-6 sm:pt-24">
			<PageMeta {...BLOG_PAGE} />
			<div className="mx-auto max-w-[1248px]">
				<h1 className="text-center text-5xl leading-[1.05] font-normal tracking-[-0.02em] text-public-ink sm:text-[72px]">{t("Estori Blog")}</h1>
				<nav aria-label={t("Blog categories")} className="mt-8">
					<ul className="flex flex-wrap justify-center gap-x-6 gap-y-3 text-[17px] text-public-ink">
						{[{ id: null, label: 'All' }, ...BLOG_CATEGORIES].map((entry) => (
							<li key={entry.label}>
								<Link
									to={entry.id ? `/blog?category=${entry.id}` : '/blog'}
									aria-current={entry.id === category ? 'page' : undefined}
									className={cn(UNDERLINE_FILL, entry.id === category && 'font-medium')}
								>
									{t(entry.label)}
								</Link>
							</li>
						))}
					</ul>
				</nav>

				{featured ? (
					<div className={cn('mt-16 grid gap-10', beside.length > 0 && 'lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]')}>
						<FeaturedPost post={featured} wide={beside.length === 0} />
						{beside.length > 0 && (
							<div>
								{beside.map((post) => (
									<PostListItem key={post.slug} post={post} />
								))}
							</div>
						)}
					</div>
				) : (
					<p className="mt-16 text-center text-[17px] text-public-muted">{t("No posts here yet.")}</p>
				)}

				{latest.length > 0 && (
					<section aria-labelledby="latest-title" className="mt-24">
						<div className="flex flex-wrap items-baseline justify-between gap-4">
							<h2 id="latest-title" className="text-4xl font-light tracking-[-0.01em] text-public-ink">{t("Latest articles")}</h2>
							<p className="text-[17px] text-public-muted">{t("{count} more", { count: latest.length })}</p>
						</div>
						<div className="mt-10 grid gap-x-8 gap-y-14 sm:grid-cols-2 lg:grid-cols-3">
							{latest.map((post) => (
								<PostCard key={post.slug} post={post} />
							))}
						</div>
					</section>
				)}
			</div>
		</div>
	);
}
