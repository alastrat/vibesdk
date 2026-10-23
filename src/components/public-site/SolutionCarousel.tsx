import { t } from '@/lib/i18n';
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '@cloudflare/kumo';
import { ArrowLeftIcon, ArrowRightIcon } from '@phosphor-icons/react';
import { findIndustry } from '@/content/industries';
import type { SolutionFeatureArt } from '@/content/solution-landings';
import { preferredScrollBehavior } from './primitives';
import { SolutionVisual } from './SolutionVisual';

export interface SolutionExample {
	title: string;
	body: string;
	prompt: string;
}

/** A manual carousel: native swipe/scroll, arrow controls and keyboard navigation; no timed slide changes. */
export function SolutionCarousel({
	title,
	examples,
	art,
	concept = false,
}: {
	title: string;
	examples: readonly SolutionExample[];
	art: readonly SolutionFeatureArt[];
	concept?: boolean;
}) {
	const id = useId();
	const track = useRef<HTMLDivElement>(null);
	const [active, setActive] = useState(0);
	const show = (index: number) => {
		const next = Math.max(0, Math.min(examples.length - 1, index));
		const slide = track.current?.children.item(next);
		if (!(slide instanceof HTMLElement) || !track.current) return;
		track.current.scrollTo({
			left: slide.offsetLeft,
			behavior: preferredScrollBehavior(),
		});
	};
	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.target !== event.currentTarget) return;
		if (event.key === 'ArrowRight') show(active + 1);
		else if (event.key === 'ArrowLeft') show(active - 1);
		else if (event.key === 'Home') show(0);
		else if (event.key === 'End') show(examples.length - 1);
		else return;
		event.preventDefault();
	};
	return (
		<section
			id="examples"
			aria-labelledby={`${id}-title`}
			aria-roledescription={t("carousel")}
			className="scroll-mt-[var(--public-header-h)] overflow-hidden bg-[#f3f5f0] px-4 py-16 sm:px-6 sm:py-24"
		>
			<div className="mx-auto max-w-[1248px]">
				<div className="flex flex-wrap items-end justify-between gap-6">
					<div>
						<p className="text-xs uppercase tracking-[0.18em] text-public-muted">{t("A little inspiration")}</p>
						<h2 id={`${id}-title`} className="mt-4 max-w-2xl text-4xl leading-[1.1] font-light tracking-tight text-public-ink sm:text-5xl">
							{t(title)}
						</h2>
						<p className="mt-4 text-sm text-public-muted">{t("Example store ideas and things you could ask Estori.")}</p>
					</div>
					<div className="public-plan-controls flex items-center gap-3">
						<span aria-live="polite" aria-atomic="true" className="mr-2 text-sm tabular-nums text-public-muted">
							{active + 1} / {examples.length}
						</span>
						<Button
							type="button"
							variant="outline"
							shape="circle"
							aria-label={t("Previous example")}
							aria-controls={`${id}-track`}
							disabled={active === 0}
							onClick={() => show(active - 1)}
						>
							<ArrowLeftIcon className="size-5" />
						</Button>
						<Button
							type="button"
							variant="outline"
							shape="circle"
							aria-label={t("Next example")}
							aria-controls={`${id}-track`}
							disabled={active === examples.length - 1}
							onClick={() => show(active + 1)}
						>
							<ArrowRightIcon className="size-5" />
						</Button>
					</div>
				</div>
				<div
					ref={track}
					id={`${id}-track`}
					role="group"
					aria-label={t("Store examples. Use left and right arrow keys to browse.")}
					tabIndex={0}
					onKeyDown={onKeyDown}
					onScroll={() => {
						const el = track.current;
						if (!el) return;
						const left = el.scrollLeft;
						let closest = 0;
						let distance = Infinity;
						Array.from(el.children).forEach((child, index) => {
							if (child instanceof HTMLElement) {
								const delta = Math.abs(child.offsetLeft - left);
								if (delta < distance) {
									distance = delta;
									closest = index;
								}
							}
						});
						setActive(closest);
					}}
					className="relative mt-10 flex snap-x snap-mandatory gap-5 overflow-x-auto overscroll-x-contain rounded-2xl pb-4 outline-none [scrollbar-width:thin] focus-visible:ring-2 focus-visible:ring-public-blue focus-visible:ring-offset-4"
				>
					{examples.map((example, index) => {
						const visual = art[index];
						const photo = visual?.photo ? findIndustry(visual.photo)?.photo : undefined;
						const image = visual?.image ?? photo;
						return (
							<article
								key={example.title}
								role="group"
								aria-roledescription={t("slide")}
								aria-label={t("{current} of {total}: {title}", { current: index + 1, total: examples.length, title: t(example.title) })}
								className="w-[92%] shrink-0 snap-start overflow-hidden rounded-2xl border border-black/10 bg-white sm:w-[78%] lg:w-[68%]"
							>
								<div className="grid h-full md:grid-cols-[1fr_1.1fr]">
									<div className="relative min-h-52 bg-[#e9eeea] md:min-h-96">
										{image ? (
											<>
												<img
													src={image.src}
													alt={t(image.alt)}
													loading="lazy"
													width={visual?.image?.width ?? 1200}
													height={visual?.image?.height ?? 800}
													className="absolute inset-0 size-full object-cover"
													style={{
														objectPosition: visual?.image?.position,
													}}
												/>
												{photo && (
													<a
														href={photo.url}
														target="_blank"
														rel="noopener noreferrer"
														className="absolute bottom-3 left-3 rounded bg-black/60 px-2 py-1 text-[9px] text-white"
													>{t("Photo: {name} / Unsplash", { name: photo.photographer })}</a>
												)}
											</>
										) : (
											<SolutionVisual kind={visual?.visual ?? 'store'} concept={concept} />
										)}
									</div>
									<div className="flex flex-col justify-between p-6 sm:p-8 lg:p-10">
										<div>
											<span className="text-[11px] uppercase tracking-[0.15em] text-public-muted">{t("Example use case")}</span>
											<h3 className="mt-4 text-3xl leading-tight font-light text-public-ink">{t(example.title)}</h3>
											<p className="mt-3 text-[15px] leading-relaxed text-public-muted">{t(example.body)}</p>
										</div>
										<div className="mt-8 rounded-xl bg-[#f5f6f3] p-4">
											<span className="text-[10px] uppercase tracking-widest text-public-muted">{t("Try asking")}</span>
											<p className="mt-2 text-sm leading-relaxed text-public-ink">“{t(example.prompt)}”</p>
										</div>
									</div>
								</div>
							</article>
						);
					})}
				</div>
			</div>
		</section>
	);
}
