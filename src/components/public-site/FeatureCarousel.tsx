import { t } from '@/lib/i18n';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router';
import { ArrowRightIcon } from '@phosphor-icons/react';
import { industryPhotoSrcSet, type IndustryFeature } from '@/content/industries';
import { cn } from '@/lib/utils';
import { FeaturePreview } from './FeaturePreview';
import { UNDERLINE_FILL } from './primitives';
import { StartBuildingButton } from './StartBuildingButton';

/**
 * Rebuy's case-study carousel, for what a store can include: a tab per feature, whose bar fills while its slide shows
 * and then hands over to the next. Clicking a tab starts its bar again. The bar holds while the carousel is off screen,
 * and while keyboard focus is in a slide, so the slide can't change under it; with reduced motion it doesn't run at all,
 * and the tabs and arrow keys still switch slides.
 */
export function FeatureCarousel({ title, features }: { title: string; features: readonly IndustryFeature[] }) {
	const id = useId();
	const sectionRef = useRef<HTMLElement>(null);
	const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
	const [active, setActive] = useState(0);
	/** Counts every change of slide, so the bar restarts even when the tab clicked is the one showing. */
	const [cycle, setCycle] = useState(0);
	const [focusInSlide, setFocusInSlide] = useState(false);
	const [onScreen, setOnScreen] = useState(false);

	useEffect(() => {
		const section = sectionRef.current;
		if (!section) return;
		const observer = new IntersectionObserver(([entry]) => setOnScreen(entry?.isIntersecting ?? false), { threshold: 0.35 });
		observer.observe(section);
		return () => observer.disconnect();
	}, []);

	const show = (index: number, focus: boolean) => {
		const next = (index + features.length) % features.length;
		setActive(next);
		setCycle((count) => count + 1);
		if (focus) tabRefs.current[next]?.focus();
	};

	const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.key === 'ArrowRight') show(active + 1, true);
		else if (event.key === 'ArrowLeft') show(active - 1, true);
		else return;
		event.preventDefault();
	};

	return (
		<section
			ref={sectionRef}
			aria-labelledby={`${id}-title`}
			className="border-t border-public-line bg-white px-4 py-20 sm:px-6 sm:py-28"
		>
			<div className="mx-auto max-w-[1248px]">
				<h2 id={`${id}-title`} className="text-center text-3xl leading-[1.15] font-light tracking-[-0.015em] text-balance text-public-ink sm:text-[40px]">
					{t(title)}
				</h2>
				<div role="tablist" aria-label={t(title)} onKeyDown={onTabKeyDown} className="mt-10 flex flex-wrap justify-center gap-2 sm:gap-3">
					{features.map((feature, index) => {
						const selected = index === active;
						return (
							<button
								key={feature.title}
								ref={(node) => {
									tabRefs.current[index] = node;
								}}
								id={`${id}-tab-${index}`}
								type="button"
								role="tab"
								aria-selected={selected}
								aria-controls={`${id}-panel-${index}`}
								tabIndex={selected ? 0 : -1}
								onClick={() => show(index, false)}
								className={cn(
									'relative overflow-hidden rounded-full bg-[#f2f0ee] px-4 py-2.5 text-[14px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-public-blue focus-visible:ring-offset-2 sm:px-6 sm:py-3 sm:text-[15px]',
									selected ? 'text-public-ink' : 'text-public-muted hover:text-public-ink',
								)}
							>
								{/* The bar grows from the left by its animation alone; with reduced motion it simply fills the selected tab. */}
								{selected && (
									<span
										key={cycle}
										aria-hidden
										onAnimationEnd={() => show(active + 1, false)}
										className={cn(
											'absolute inset-0 origin-left bg-[#dedad5] animate-public-autoplay',
											(focusInSlide || !onScreen) && '[animation-play-state:paused]',
										)}
									/>
								)}
								<span className="relative">{t(feature.title)}</span>
							</button>
						);
					})}
				</div>
				{/* Every slide sits in the same cell, so the card keeps the tallest one's height as they fade between each other. */}
				<div
					className="mt-10 grid"
					// Only keyboard focus holds the slide; a mouse click on a link in it doesn't.
					onFocus={(event) => setFocusInSlide(event.target.matches(':focus-visible'))}
					onBlur={(event) => {
						if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) setFocusInSlide(false);
					}}
				>
					{features.map((feature, index) => (
						<div
							key={feature.title}
							id={`${id}-panel-${index}`}
							role="tabpanel"
							aria-labelledby={`${id}-tab-${index}`}
							inert={index !== active}
							className={cn(
								'grid overflow-hidden rounded-[28px] transition-opacity duration-500 [grid-area:1/1] motion-reduce:transition-none lg:grid-cols-2 lg:rounded-[40px]',
								index === active ? 'opacity-100' : 'opacity-0',
							)}
						>
							<div className="relative min-h-[24rem] sm:min-h-[30rem]">
								<img
									src={feature.photo.src}
									srcSet={industryPhotoSrcSet(feature.photo)}
									sizes="(min-width: 1296px) 624px, (min-width: 1024px) 50vw, 100vw"
									width={1200}
									height={800}
									loading="lazy"
									alt={t(feature.photo.alt)}
									className="absolute inset-0 size-full object-cover"
								/>
								<div className="absolute inset-x-5 bottom-5 sm:inset-x-8 sm:bottom-8">
									<FeaturePreview preview={feature.preview} />
								</div>
							</div>
							<div className="relative flex flex-col justify-center p-8 text-white sm:p-12 lg:p-14" style={{ backgroundColor: feature.accent }}>
								<span aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_90%_at_100%_0%,rgba(255,255,255,0.2),transparent_60%)]" />
								<div className="relative">
									<h3 className="text-4xl leading-[1.08] font-light tracking-[-0.02em] text-balance sm:text-5xl">{t(feature.title)}</h3>
									<p className="mt-4 max-w-md text-[17px] leading-relaxed font-light text-white/80">{t(feature.body)}</p>
									<blockquote className="mt-8 max-w-lg text-xl leading-snug sm:text-2xl">&ldquo;{t(feature.request)}&rdquo;</blockquote>
									<p className="mt-4 text-[15px]">
										<span className="block font-medium">{t("Ask Estori")}</span>
										<span className="text-white/75">{t("An example request")}</span>
									</p>
									<div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-4">
										<StartBuildingButton variant="outline-on-dark" />
										<Link to="/discover" className={cn('inline-flex items-center gap-2 text-[16px] text-white', UNDERLINE_FILL)}>{t("Browse templates")}<ArrowRightIcon className="size-4" aria-hidden />
										</Link>
									</div>
									<p className="mt-10 text-[12px] text-white/65">
										<a href={feature.photo.url} target="_blank" rel="noopener noreferrer" className="hover:text-white">{t("Photo by")} {feature.photo.photographer} {t("on Unsplash")}</a>
									</p>
								</div>
							</div>
						</div>
					))}
				</div>
			</div>
		</section>
	);
}
