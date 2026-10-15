import { Fragment, useEffect, type ReactNode } from 'react';
import { Link } from 'react-router';
import { pageTitle } from '@/brand';
import { BlurFade } from '@/components/magicui/blur-fade';
import type { CardCopy } from '@/content/positioning';
import type { CapabilityId } from '@/lib/capabilities';
import { absoluteUrl, type Crumb } from '@/lib/seo';
import { cn } from '@/lib/utils';
import { CapabilityTag } from './CapabilityTag';
import { Eyebrow, HEADING_CARD, HEADING_SECTION, LEAD, UNDERLINE_GROW } from './primitives';
import { StartBuildingButton } from './StartBuildingButton';

/** index.html's title and description, there for link previews that never run the app, give way to the page's own. */
function useReplaceDefaultHead() {
	useEffect(() => {
		const defaults = [...document.head.querySelectorAll('[data-default]')];
		for (const element of defaults) element.remove();
		// Put back when the page goes, for pages that set no title of their own.
		return () => document.head.append(...defaults);
	}, []);
}

/**
 * The page's title and description for search results and shared links. With its path, the page also names its
 * canonical address; with an image, shared links show it large.
 */
export function PageMeta({ title, description, path, image }: { title: string; description: string; path?: string; image?: { src: string; alt: string } }) {
	useReplaceDefaultHead();
	const fullTitle = pageTitle(title);
	const origin = window.location.origin;
	const url = path === undefined ? undefined : absoluteUrl(path, origin);
	return (
		<>
			<title>{fullTitle}</title>
			<meta name="description" content={description} />
			<meta property="og:type" content="website" />
			<meta property="og:title" content={fullTitle} />
			<meta property="og:description" content={description} />
			<meta name="twitter:card" content={image ? 'summary_large_image' : 'summary'} />
			{url && <link rel="canonical" href={url} />}
			{url && <meta property="og:url" content={url} />}
			{image && <meta property="og:image" content={absoluteUrl(image.src, origin)} />}
			{image && <meta property="og:image:alt" content={image.alt} />}
		</>
	);
}

/** Where the page sits in the site, in the eyebrow's place: every step a link except the page itself. */
function Breadcrumbs({ crumbs }: { crumbs: readonly Crumb[] }) {
	const current = crumbs.length - 1;
	return (
		<nav aria-label="Breadcrumb" className="text-xs tracking-[0.02em] uppercase">
			<ol className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
				{crumbs.map((crumb, index) => (
					<Fragment key={crumb.path}>
						{index > 0 && (
							<li aria-hidden className="text-white/50">
								/
							</li>
						)}
						<li>
							{index === current ? (
								<span aria-current="page" className="text-white">
									{crumb.name}
								</span>
							) : (
								<Link to={crumb.path} className={cn('text-white/80 hover:text-white', UNDERLINE_GROW)}>
									{crumb.name}
								</Link>
							)}
						</li>
					</Fragment>
				))}
			</ol>
		</nav>
	);
}

/** Above the headline: an eyebrow, or the breadcrumb trail on pages that sit under another. */
type HeroLabel = { eyebrow: string; crumbs?: undefined } | { crumbs: readonly Crumb[]; eyebrow?: undefined };

/** 1Password's solution hero on charcoal: eyebrow or breadcrumbs and status, headline, lead and actions. */
export function SolutionHero({
	eyebrow,
	crumbs,
	title,
	lead,
	tag,
	actions,
}: HeroLabel & {
	title: string;
	lead: string;
	tag?: CapabilityId;
	actions?: ReactNode;
}) {
	return (
		<section className="bg-public-charcoal px-4 pt-20 pb-24 text-center text-white sm:px-6 sm:pt-28 sm:pb-28">
			<div className="flex flex-wrap items-center justify-center gap-3">
				{crumbs ? <Breadcrumbs crumbs={crumbs} /> : <Eyebrow tone="dark">{eyebrow}</Eyebrow>}
				{tag && <CapabilityTag id={tag} tone="dark" />}
			</div>
			<h1 className={cn(HEADING_SECTION, 'mx-auto mt-4 max-w-4xl text-balance')}>{title}</h1>
			<p className={cn(LEAD, 'mx-auto mt-5 max-w-2xl text-pretty text-white/80')}>{lead}</p>
			<div className="mt-10 flex flex-wrap items-center justify-center gap-3">
				{actions ?? (
					<StartBuildingButton variant="white" />
				)}
			</div>
		</section>
	);
}

/** A titled section of value cards; `id` makes it a link target below the sticky top bar. */
export function CardSection({
	id,
	eyebrow,
	title,
	lead,
	tag,
	cards,
	children,
}: {
	id?: string;
	eyebrow?: string;
	title: string;
	lead?: string;
	tag?: CapabilityId;
	cards: readonly CardCopy[];
	children?: ReactNode;
}) {
	return (
		<section id={id} className="scroll-mt-36 border-t border-public-line bg-white px-4 py-20 sm:px-6 sm:py-28">
			<BlurFade inView className="mx-auto max-w-[1248px]">
				{(eyebrow || tag) && (
					<div className="flex flex-wrap items-center gap-3">
						{eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
						{tag && <CapabilityTag id={tag} />}
					</div>
				)}
				<h2 className={cn(HEADING_SECTION, 'mt-4 max-w-3xl text-balance text-public-ink')}>{title}</h2>
				{lead && <p className={cn(LEAD, 'mt-5 max-w-2xl text-pretty text-public-muted')}>{lead}</p>}
				{cards.length > 0 && (
					<div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
						{cards.map((card) => (
							<article key={card.title} className="rounded-[24px] p-7 ring ring-public-line">
								<h3 className={cn(HEADING_CARD, 'text-public-ink')}>{card.title}</h3>
								<p className="mt-3 text-[15px] leading-relaxed font-light text-public-muted">{card.body}</p>
							</article>
						))}
					</div>
				)}
				{children && <div className="mt-10 flex flex-wrap items-center gap-4">{children}</div>}
			</BlurFade>
		</section>
	);
}

export function HowItWorks({ steps }: { steps: readonly string[] }) {
	return (
		<section className="border-t border-public-line bg-white px-4 py-20 sm:px-6 sm:py-28">
			<div className="mx-auto max-w-[1248px]">
				<Eyebrow>How it works</Eyebrow>
				<ol className="mt-8 grid gap-4 md:grid-cols-3">
					{steps.map((step, index) => (
						<li key={step} className="rounded-[24px] bg-public-charcoal p-7 text-white">
							<span className="text-sm text-white/70">Step {index + 1}</span>
							<p className="mt-3 text-xl leading-snug font-light">{step}</p>
						</li>
					))}
				</ol>
			</div>
		</section>
	);
}
