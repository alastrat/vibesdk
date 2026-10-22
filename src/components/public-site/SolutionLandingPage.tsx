import { Link } from 'react-router';
import { ArrowRightIcon, SparkleIcon } from '@phosphor-icons/react';
import { isEarlyAccessCapability } from '@/api-types';
import { findIndustry, industryPhotoSrcSet } from '@/content/industries';
import { marketingCopy } from '@/content/marketing-copy';
import { SOLUTION_LANDINGS, type SolutionId } from '@/content/solution-landings';
import { useEarlyAccessFromUrl } from '@/hooks/use-early-access';
import { CAPABILITIES } from '@/lib/capabilities';
import { cn } from '@/lib/utils';
import { AnimatedSolutionSteps } from './AnimatedSolutionSteps';
import { CapabilityTag } from './CapabilityTag';
import { EarlyAccessButton } from './EarlyAccessButton';
import { PillLink, UNDERLINE_GROW } from './primitives';
import { PublicFaq } from './PublicFaq';
import { SolutionCarousel } from './SolutionCarousel';
import { SolutionVisual } from './SolutionVisual';
import { StartBuildingButton } from './StartBuildingButton';

function SolutionActions({ id, dark = false }: { id: SolutionId; dark?: boolean }) {
	const { capability } = SOLUTION_LANDINGS[id];
	const early = capability && isEarlyAccessCapability(capability);
	return (
		<div className="flex flex-wrap items-center justify-center gap-3">
			{early ? (
				<>
					<EarlyAccessButton
						capability={capability}
						variant={dark ? 'white' : 'blue'}
						listedClassName={dark ? 'text-white' : 'text-public-ink'}
					/>
					<StartBuildingButton variant={dark ? 'outline-on-dark' : 'outline-on-light'} />
				</>
			) : (
				<>
					<StartBuildingButton variant={dark ? 'white' : 'blue'} />
					<PillLink to="/contact" variant={dark ? 'outline-on-dark' : 'outline-on-light'}>
						Talk to sales
					</PillLink>
				</>
			)}
		</div>
	);
}

/** Audience pages share presentation, while their copy, examples and availability remain specific. */
export function SolutionLandingPage({ id }: { id: SolutionId }) {
	useEarlyAccessFromUrl();
	const page = SOLUTION_LANDINGS[id];
	const { copy, capability } = page;
	const concept = capability !== undefined && CAPABILITIES[capability].status !== 'available';
	return (
		<div>
			<section className="overflow-hidden bg-[#fafbf8] px-4 pb-12 pt-14 sm:px-6 sm:pb-20 sm:pt-20">
				<div className="mx-auto max-w-[1248px] text-center">
					<div className="flex flex-wrap items-center justify-center gap-3">
						<p className="text-xs uppercase tracking-[0.18em] text-public-muted">{copy.eyebrow}</p>
						{capability && <CapabilityTag id={capability} />}
					</div>
					<h1 className="mx-auto mt-5 max-w-5xl text-[44px] font-light leading-[1.06] tracking-[-0.035em] text-balance text-public-ink sm:text-[64px] lg:text-[76px]">
						{copy.title}
					</h1>
					<p className="mx-auto mt-6 max-w-2xl text-lg font-light leading-relaxed text-pretty text-public-muted">{copy.lead}</p>
					<div className="mt-8">
						<SolutionActions id={id} />
					</div>
					<div
						role="img"
						aria-label={`${copy.eyebrow}: ${page.art.hero === 'community' ? 'subscription confirmation example' : `${concept ? 'concept' : 'illustrative'} storefront`}`}
						className="mx-auto mt-12 max-w-[1040px] overflow-hidden rounded-[24px] border border-[#d4ded1] text-left shadow-[0_30px_80px_-45px_#253a2f66] sm:mt-16 sm:rounded-[32px]"
					>
						<SolutionVisual kind={page.art.hero} concept={concept} />
					</div>
				</div>
			</section>

			<section className="bg-[#193b2e] px-4 py-14 text-white sm:px-6 sm:py-20">
				<div className="mx-auto max-w-[1248px]">
					<p className="text-[11px] uppercase tracking-[0.2em] text-white/65">Sound familiar?</p>
					<div className="mt-5 grid gap-10 lg:grid-cols-[1fr_1.2fr]">
						<h2 className="max-w-md text-3xl font-light leading-tight tracking-tight sm:text-4xl">{copy.problemTitle}</h2>
						<ul className="grid gap-6">
							{copy.problems.map((problem) => (
								<li key={problem} className="flex items-start gap-4 text-lg font-light text-white/90">
									<span className="mt-2 size-2 shrink-0 rounded-full bg-[#d0dcbd]" />
									{problem}
								</li>
							))}
						</ul>
					</div>
				</div>
			</section>

			<section
				id={page.sectionId ?? 'benefits'}
				className="scroll-mt-[calc(var(--public-header-h)+1rem)] bg-white px-4 py-16 sm:px-6 sm:py-24"
			>
				<div className="mx-auto max-w-[1248px]">
					<div className="mx-auto max-w-3xl text-center">
						<p className="text-xs uppercase tracking-[0.18em] text-public-muted">Made for your business</p>
						<h2 className="mt-4 text-4xl font-light leading-[1.1] tracking-tight text-balance text-public-ink sm:text-5xl">
							{copy.benefitsTitle}
						</h2>
						<p className="mt-5 text-lg font-light leading-relaxed text-public-muted">{copy.benefitsLead}</p>
					</div>
					<div className="mt-12 grid gap-5 md:grid-cols-12">
						{copy.features.map((feature, index) => {
							const art = page.art.features[index];
							const photo = art?.photo ? findIndustry(art.photo)?.photo : undefined;
							const image = art?.image ?? photo;
							const wide = index === 0 || index === 3;
							return (
								<article
									key={feature.title}
									className={cn(
										'relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-black/10',
										wide ? 'md:col-span-7' : 'md:col-span-5',
										image ? 'min-h-[380px] justify-end sm:min-h-[440px]' : 'bg-[#f7f8f5]',
									)}
								>
									{image ? (
										<>
											<img
												src={image.src}
												srcSet={photo ? industryPhotoSrcSet(photo) : undefined}
												sizes="(min-width: 1024px) 700px, 100vw"
												alt={image.alt}
												width={art?.image?.width ?? 1200}
												height={art?.image?.height ?? 800}
												loading="lazy"
												className="absolute inset-0 size-full object-cover"
												style={{
													objectPosition: art?.image?.position,
												}}
											/>
											<div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/15 to-black/5" />
											{photo && (
												<a
													href={photo.url}
													target="_blank"
													rel="noopener noreferrer"
													className="absolute right-4 top-4 rounded bg-black/45 px-2 py-1 text-[9px] text-white/90"
												>
													Photo: {photo.photographer} / Unsplash
												</a>
											)}
										</>
									) : (
										<SolutionVisual kind={art?.visual ?? 'store'} concept={concept} />
									)}
									<div className={cn('relative p-6 sm:p-8', image ? 'text-white' : 'text-public-ink')}>
										<h3 className="text-2xl font-normal leading-tight tracking-tight">{feature.title}</h3>
										<p
											className={cn('mt-3 max-w-xl text-[15px] font-light leading-relaxed', image ? 'text-white/85' : 'text-public-muted')}
										>
											{feature.body}
										</p>
									</div>
								</article>
							);
						})}
					</div>
					{page.more && (
						<div className="mt-8 flex justify-center">
							<Link to={page.more.to} className={cn('inline-flex items-center gap-2 text-sm text-public-ink', UNDERLINE_GROW)}>
								{page.more.label}
								<ArrowRightIcon className="size-4" />
							</Link>
						</div>
					)}
				</div>
			</section>

			<AnimatedSolutionSteps steps={copy.steps} />

			<SolutionCarousel title={copy.carouselTitle} examples={copy.examples} art={page.art.examples} concept={concept} />

			{page.future.length > 0 && (
				<section className="bg-white px-4 py-16 sm:px-6 sm:py-24">
					<div className="mx-auto max-w-[1248px]">
						<p className="text-xs uppercase tracking-[0.18em] text-public-muted">Built for growth</p>
						<h2 className="mt-4 max-w-2xl text-4xl font-light leading-tight text-public-ink">More ways to grow your business.</h2>
						<div className="mt-8 grid gap-4 md:grid-cols-3">
							{page.future.map((item) => (
								<article
									id={item.id}
									key={item.id}
									className="scroll-mt-[calc(var(--public-header-h)+1rem)] rounded-2xl border border-public-line p-6"
								>
									<SparkleIcon className="size-6 text-[#426249]" />
									<div className="mt-5">
										<CapabilityTag id={item.capability} />
									</div>
									<h3 className="mt-3 text-xl text-public-ink">{CAPABILITIES[item.capability].name}</h3>
									<p className="mt-3 text-sm leading-relaxed text-public-muted">{CAPABILITIES[item.capability].description}</p>
									{item.detailLink && (
										<Link
											to={CAPABILITIES[item.capability].path}
											className={cn('mt-5 inline-flex items-center gap-2 text-sm text-public-ink', UNDERLINE_GROW)}
										>
											{marketingCopy.common.learnMore}
											<ArrowRightIcon className="size-4" aria-hidden />
										</Link>
									)}
								</article>
							))}
						</div>
					</div>
				</section>
			)}

			<section className="bg-[#193b2e] px-4 py-16 text-center text-white sm:px-6 sm:py-24">
				<div className="mx-auto max-w-3xl">
					<h2 className="text-4xl font-light leading-tight tracking-tight text-balance sm:text-5xl">{copy.closingTitle}</h2>
					<p className="mx-auto mt-5 max-w-xl text-lg font-light text-white/80">{copy.closingLead}</p>
					<div className="mt-8">
						<SolutionActions id={id} dark />
					</div>
				</div>
			</section>
			<PublicFaq items={page.faq} />
		</div>
	);
}
