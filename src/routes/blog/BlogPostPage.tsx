import { PLATFORM_FEE_LABEL } from '@/api-types';
import { getLocale, t } from '@/lib/i18n';
import { Link, useParams } from 'react-router';
import { ArrowLeftIcon } from '@phosphor-icons/react';
import { BlogArt } from '@/components/blog/BlogArt';
import { CategoryTags } from '@/components/blog/BlogCards';
import { PillLink, UNDERLINE_FILL } from '@/components/public-site/primitives';
import { PageMeta } from '@/components/public-site/solution-page';
import { StartBuildingButton } from '@/components/public-site/StartBuildingButton';
import { findBlogPost, formatBlogDate, type BlogBlock } from '@/content/blog';
import { blogPostPage } from '@/content/public-pages';
import { cn } from '@/lib/utils';

function BackToBlog() {
	return (
		<Link to="/blog" className={cn('inline-flex items-center gap-2 text-[17px] text-public-ink', UNDERLINE_FILL)}>
			<ArrowLeftIcon className="size-4" aria-hidden />{t("Back to blog")}</Link>
	);
}

function Block({ block }: { block: BlogBlock }) {
	if (block.type === 'heading') return <h2 className="mt-12 text-[28px] leading-snug font-normal tracking-[-0.01em] text-public-ink">{t(block.text, { fee: PLATFORM_FEE_LABEL })}</h2>;
	if (block.type === 'paragraph') return <p className="mt-5 text-[19px] leading-[1.65] text-public-ink/85">{t(block.text, { fee: PLATFORM_FEE_LABEL })}</p>;
	const List = block.ordered ? 'ol' : 'ul';
	return (
		<List className={cn('mt-5 grid gap-3 pl-6 text-[19px] leading-[1.65] text-public-ink/85', block.ordered ? 'list-decimal' : 'list-disc')}>
			{block.items.map((item) => (
				<li key={t(item, { fee: PLATFORM_FEE_LABEL })} className="pl-1">
					{t(item, { fee: PLATFORM_FEE_LABEL })}
				</li>
			))}
		</List>
	);
}

/** 1Password's blog post: back to the blog, the title and byline, a wide drawing, then the article beside its categories. */
export default function BlogPostPage() {
	const { slug } = useParams();
	const post = slug ? findBlogPost(slug) : undefined;

	if (!post) {
		return (
			<div className="bg-white px-4 py-24 sm:px-6">
				<PageMeta title={t("Post not found")} description={t("This blog post doesn't exist.")} />
				<div className="mx-auto max-w-[1248px]">
					<BackToBlog />
					<h1 className="mt-8 text-4xl font-normal tracking-[-0.02em] text-public-ink">{t("We couldn't find that post")}</h1>
					<p className="mt-4 text-[18px] text-public-muted">{t("It may have moved. Every post is listed on the blog.")}</p>
				</div>
			</div>
		);
	}

	return (
		<article className="bg-white px-4 pt-14 pb-24 sm:px-6 sm:pt-20">
			<PageMeta {...blogPostPage(post)} />
			<div className="mx-auto max-w-[1248px]">
				<BackToBlog />
				<h1 className="mt-8 max-w-4xl text-[40px] leading-[1.08] font-normal tracking-[-0.02em] text-balance text-public-ink sm:text-[64px]">{t(post.title)}</h1>
				<div className="mt-8 text-[16px]">
					<p className="text-public-ink">{t("by {name}", { name: post.author === 'The Estori team' ? t('The Estori team') : post.author })}</p>
					<p className="mt-1 text-public-muted">
						<time dateTime={post.publishedAt}>{formatBlogDate(post.publishedAt, getLocale())}</time> · {t("{minutes} min read", { minutes: post.readMinutes })}</p>
				</div>
				<BlogArt id={post.art} className="mt-12 aspect-[16/9] rounded-3xl sm:aspect-[16/7]" />

				<div className="mt-14 grid gap-12 lg:grid-cols-[minmax(0,46rem)_1fr] lg:gap-20">
					<div>
						<p className="text-[22px] leading-relaxed font-light text-public-ink">{t(post.summary)}</p>
						{post.body.map((block, index) => (
							<Block key={index} block={block} />
						))}
						<div className="mt-14 flex flex-wrap gap-3 border-t border-public-line pt-10">
							<StartBuildingButton />
							<PillLink to="/discover" variant="outline-on-light">{t("Browse Discover")}</PillLink>
						</div>
					</div>
					<aside className="lg:sticky lg:top-[calc(var(--public-header-h)+2rem)] lg:self-start">
						<p className="text-[13px] tracking-[0.06em] text-public-muted uppercase">{t("Related categories")}</p>
						<CategoryTags categories={post.categories} className="mt-4" />
					</aside>
				</div>
			</div>
		</article>
	);
}
