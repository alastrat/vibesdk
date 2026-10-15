import { Link, useParams } from 'react-router';
import { ChatCircleTextIcon } from '@phosphor-icons/react';
import { FeatureCarousel } from '@/components/public-site/FeatureCarousel';
import { IndustryCards } from '@/components/public-site/IndustryCards';
import { JsonLd } from '@/components/public-site/JsonLd';
import { Eyebrow, HEADING_SECTION, LEAD, PillLink, UNDERLINE_GROW } from '@/components/public-site/primitives';
import { PublicFaq } from '@/components/public-site/PublicFaq';
import { PageMeta, SolutionHero } from '@/components/public-site/solution-page';
import { StartBuildingButton } from '@/components/public-site/StartBuildingButton';
import {
	INDUSTRIES,
	INDUSTRIES_PATH,
	findIndustry,
	industryCrumbs,
	industryFaq,
	industryPath,
	industryPhotoSrcSet,
	industryStructuredData,
	type Industry,
} from '@/content/industries';
import { cn } from '@/lib/utils';
import { ClosingPanel } from '@/routes/landing/sections';

/** The industry's photo, straddling the bottom of the dark hero, with its Unsplash credit beneath. */
function HeroPhoto({ industry }: { industry: Industry }) {
	return (
		<figure className="bg-white">
			<div className="relative px-4 sm:px-6">
				{/* The hero's charcoal runs on, full width, behind the top half of the photo. */}
				<span aria-hidden className="absolute inset-x-0 top-0 bottom-1/2 bg-public-charcoal" />
				<img
					src={industry.photo.src}
					srcSet={industryPhotoSrcSet(industry.photo)}
					sizes="(min-width: 1296px) 1248px, calc(100vw - 3rem)"
					width={1200}
					height={800}
					fetchPriority="high"
					alt={industry.photo.alt}
					className="relative mx-auto aspect-[3/2] w-full max-w-[1248px] rounded-[24px] object-cover sm:aspect-[2/1]"
				/>
			</div>
			<figcaption className="mt-3 px-4 text-[13px] text-public-muted sm:px-6">
				<p className="mx-auto max-w-[1248px] text-right">
					<a href={industry.photo.url} target="_blank" rel="noopener noreferrer" className={cn('hover:text-public-ink', UNDERLINE_GROW)}>
						Photo by {industry.photo.photographer} on Unsplash
					</a>
				</p>
			</figcaption>
		</figure>
	);
}

/** An industry's page: the solution template, with a direct answer, requests a seller might make, and their questions. */
export default function IndustryPage() {
	const { slug } = useParams();
	const industry = slug ? findIndustry(slug) : undefined;

	if (!industry) {
		return (
			<section className="bg-white px-4 py-24 sm:px-6">
				<PageMeta title="Industry not found" description="This industry page doesn't exist." />
				<div className="mx-auto max-w-[1248px]">
					<h1 className="text-4xl font-normal tracking-[-0.02em] text-public-ink">We couldn't find that industry</h1>
					<p className="mt-4 text-[18px] text-public-muted">
						See{' '}
						<Link to={INDUSTRIES_PATH} className="underline underline-offset-4">
							every industry
						</Link>
						, or{' '}
						<Link to="/" className="underline underline-offset-4">
							start from the home page
						</Link>
						.
					</p>
				</div>
			</section>
		);
	}

	return (
		<div>
			<PageMeta
				title={industry.metaTitle}
				description={industry.metaDescription}
				path={industryPath(industry.slug)}
				image={industry.photo}
			/>
			<JsonLd data={industryStructuredData(industry, window.location.origin)} />
			<SolutionHero
				crumbs={industryCrumbs(industry)}
				title={industry.title}
				lead={industry.lead}
				actions={
					<>
						<StartBuildingButton variant="white" />
						<PillLink to="/discover" variant="outline-on-dark">
							Browse templates
						</PillLink>
					</>
				}
			/>
			<HeroPhoto industry={industry} />
			<section className="bg-white px-4 pt-16 pb-20 sm:px-6 sm:pt-20 sm:pb-28">
				<div className="mx-auto grid max-w-[1248px] gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] lg:gap-16">
					<h2 className="text-3xl leading-[1.15] font-light tracking-[-0.015em] text-balance text-public-ink sm:text-[40px]">
						What is Estori for {industry.audience}?
					</h2>
					<p className="text-[19px] leading-[1.65] font-light text-pretty text-public-ink/85 sm:text-[22px]">{industry.summary}</p>
				</div>
			</section>
			<section className="border-t border-public-line bg-white px-4 py-20 sm:px-6 sm:py-28">
				<div className="mx-auto max-w-[1248px]">
					<Eyebrow>Ask in plain words</Eyebrow>
					<h2 className={cn(HEADING_SECTION, 'mt-4 max-w-3xl text-balance text-public-ink')}>Describe your {industry.store}</h2>
					<p className={cn(LEAD, 'mt-5 max-w-2xl text-pretty text-public-muted')}>
						Start with a sentence like one of these, then keep asking for changes until the store is yours.
					</p>
					<ul className="mt-12 grid gap-4 md:grid-cols-3">
						{industry.prompts.map((prompt) => (
							<li key={prompt} className="flex flex-col gap-4 rounded-[24px] bg-[#f4f6fb] p-7">
								<ChatCircleTextIcon className="size-6 text-public-blue" aria-hidden />
								<p className="text-xl leading-snug font-light text-public-ink">{prompt}</p>
							</li>
						))}
					</ul>
				</div>
			</section>
			<FeatureCarousel title={`What your ${industry.store} can include`} features={industry.features} />
			<PublicFaq items={industryFaq(industry)} />
			<section className="bg-white px-4 py-20 sm:px-6 sm:py-28">
				<div className="mx-auto max-w-[1248px]">
					<Eyebrow>More industries</Eyebrow>
					<h2 className={cn(HEADING_SECTION, 'mt-4 mb-12 max-w-3xl text-balance text-public-ink')}>Estori for other brands</h2>
					<IndustryCards
						industries={INDUSTRIES.filter((other) => other.slug !== industry.slug)}
						showAll
					/>
				</div>
			</section>
			<ClosingPanel />
		</div>
	);
}
