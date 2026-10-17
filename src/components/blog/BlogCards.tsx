import { Link } from 'react-router';
import { BLOG_CATEGORIES, blogPostPath, formatBlogDate, type BlogCategoryId, type BlogPost } from '@/content/blog';
import { cn } from '@/lib/utils';
import { BlogArt } from './BlogArt';

const DATE = 'text-[13px] tracking-[0.06em] text-public-muted uppercase';
const TITLE_HOVER = 'underline-offset-4 decoration-1 group-hover:underline';
const LINK_HOVER = 'underline-offset-4 decoration-1 hover:underline';

/** The post's categories as small outlined tags, each opening the blog on that category. */
export function CategoryTags({ categories, className }: { categories: readonly BlogCategoryId[]; className?: string }) {
	return (
		<ul className={cn('flex flex-wrap gap-2', className)}>
			{categories.map((id) => (
				<li key={id}>
					<Link
						to={`/blog?category=${id}`}
						className="inline-block rounded-md border border-public-line px-2 py-0.5 text-[13px] text-public-ink transition-colors hover:border-public-ink"
					>
						{BLOG_CATEGORIES.find((category) => category.id === id)?.label}
					</Link>
				</li>
			))}
		</ul>
	);
}

/** The newest post, large, as on 1Password: its drawing, date, title, byline and summary. */
export function FeaturedPost({ post, wide }: { post: BlogPost; wide: boolean }) {
	return (
		<article className={cn('overflow-hidden rounded-3xl border border-public-line', wide && 'lg:grid lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]')}>
			<Link to={blogPostPath(post.slug)} className="block" tabIndex={-1} aria-hidden>
				<BlogArt id={post.art} className={cn('aspect-[16/9]', wide && 'lg:aspect-auto lg:h-full lg:min-h-[24rem]')} />
			</Link>
			<div className="flex flex-col p-8 sm:p-10">
				<p className={DATE}>{formatBlogDate(post.publishedAt)}</p>
				<h2 className="mt-3 text-3xl leading-[1.15] font-normal tracking-[-0.01em] text-public-ink sm:text-[40px]">
					<Link to={blogPostPath(post.slug)} className={LINK_HOVER}>
						{post.title}
					</Link>
				</h2>
				<p className="mt-4 text-[17px] text-public-ink">by {post.author}</p>
				<p className="mt-4 text-[18px] leading-relaxed font-light text-public-muted">{post.summary}</p>
				<CategoryTags categories={post.categories} className="mt-6" />
			</div>
		</article>
	);
}

/** A post in a list beside the featured one: date and title. */
export function PostListItem({ post }: { post: BlogPost }) {
	return (
		<article className="border-b border-public-line py-6 first:pt-0">
			<p className={DATE}>{formatBlogDate(post.publishedAt)}</p>
			<h3 className="mt-2 text-2xl leading-snug font-normal text-public-ink">
				<Link to={blogPostPath(post.slug)} className={LINK_HOVER}>
					{post.title}
				</Link>
			</h3>
		</article>
	);
}

/** A post in the grid: drawing, date, title and tags. */
export function PostCard({ post }: { post: BlogPost }) {
	return (
		<article>
			<Link to={blogPostPath(post.slug)} className="group block">
				<BlogArt id={post.art} className="aspect-[16/9] rounded-2xl" />
				<p className={cn(DATE, 'mt-5')}>{formatBlogDate(post.publishedAt)}</p>
				<h3 className={cn('mt-2 text-2xl leading-snug font-normal text-public-ink', TITLE_HOVER)}>{post.title}</h3>
			</Link>
			<CategoryTags categories={post.categories} className="mt-4" />
		</article>
	);
}
