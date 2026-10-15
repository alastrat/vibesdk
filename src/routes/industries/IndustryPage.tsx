import { Link, useParams } from 'react-router';
import { ChatCircleTextIcon } from '@phosphor-icons/react';
import { Eyebrow, HEADING_SECTION, LEAD, PillLink } from '@/components/public-site/primitives';
import { CardSection, HowItWorks, PageMeta, SolutionHero } from '@/components/public-site/solution-page';
import { StartBuildingButton } from '@/components/public-site/StartBuildingButton';
import { findIndustry } from '@/content/industries';
import { BRAND_STEPS, TODAY_CARDS } from '@/content/positioning';
import { cn } from '@/lib/utils';
import { ClosingPanel } from '@/routes/landing/sections';

/** An industry's page: the solution template, with requests a seller in it might make and what its stores can include. */
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
						Every industry is listed under Solutions. Or{' '}
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
			<PageMeta title={industry.name} description={`${industry.title}. ${industry.lead}`} />
			<SolutionHero
				eyebrow={industry.name}
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
			<section className="bg-white px-4 py-20 sm:px-6 sm:py-28">
				<div className="mx-auto max-w-[1248px]">
					<Eyebrow>Ask in plain words</Eyebrow>
					<h2 className={cn(HEADING_SECTION, 'mt-4 max-w-3xl text-balance text-public-ink')}>Tell Estori what you sell</h2>
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
			<CardSection eyebrow={industry.name} title="What your store can include" cards={industry.features}>
				<StartBuildingButton />
			</CardSection>
			<CardSection eyebrow="Available today" title="What every store comes with" cards={TODAY_CARDS} />
			<HowItWorks steps={BRAND_STEPS} />
			<ClosingPanel />
		</div>
	);
}
