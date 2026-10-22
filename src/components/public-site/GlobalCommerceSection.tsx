import { useEffect, useRef, useState } from 'react';
import { Button } from '@cloudflare/kumo';
import { ArrowRightIcon, PauseIcon, PlayIcon, SparkleIcon } from '@phosphor-icons/react';
import { marketingCopy } from '@/content/marketing-copy';
import { GLOBAL_MARKETS } from './globe/markets';
import { REDUCED_MOTION_QUERY, prefersReducedMotion } from '@/lib/motion';
import { useMarketRotation } from '@/hooks/use-market-rotation';
import { GlobalCommerceGlobe } from './GlobalCommerceGlobe';
import { StartBuildingButton } from './StartBuildingButton';
import { TextLink } from './primitives';

const copy = marketingCopy.home.globalCommerce;

export function GlobalCommerceSection() {
	const section = useRef<HTMLElement>(null);
	const [visible, setVisible] = useState(false);
	const [tabVisible, setTabVisible] = useState(true);
	const [reduced, setReduced] = useState(prefersReducedMotion);
	const story = useMarketRotation(GLOBAL_MARKETS.length, visible && tabVisible && !reduced);
	const market = GLOBAL_MARKETS[story.active];
	useEffect(() => {
		const element = section.current;
		if (!element) return;
		const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.12 });
		observer.observe(element);
		const media = window.matchMedia(REDUCED_MOTION_QUERY);
		const onMotion = () => setReduced(media.matches);
		const onVisibility = () => setTabVisible(!document.hidden);
		media.addEventListener('change', onMotion);
		document.addEventListener('visibilitychange', onVisibility);
		onMotion();
		onVisibility();
		return () => {
			observer.disconnect();
			media.removeEventListener('change', onMotion);
			document.removeEventListener('visibilitychange', onVisibility);
		};
	}, []);
	return (
		<section
			ref={section}
			id="global-commerce"
			aria-labelledby="global-commerce-title"
			className="global-commerce-section"
			data-playing={story.playing}
		>
			<div className="global-commerce-panel">
				<div className="global-commerce-grid">
					<div className="global-commerce-copy">
						<p className="global-commerce-eyebrow">{copy.eyebrow}</p>
						<h2 id="global-commerce-title" className="global-commerce-heading">
							<span className="sr-only">{copy.accessibleTitle}</span>
							<span aria-hidden="true">
								{copy.title}
								<span className="global-commerce-words">
									{copy.words.map((word, index) => (
										<span key={word} data-active={reduced || story.active % 2 === index}>
											{word}
										</span>
									))}
								</span>
							</span>
						</h2>
						<p className="global-commerce-description">{copy.description}</p>
						<div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-4">
							<StartBuildingButton variant="white" />
							<TextLink to="/agentic-commerce" tone="dark" className="inline-flex items-center gap-2">
								{copy.link}
								<ArrowRightIcon aria-hidden="true" size={16} />
							</TextLink>
						</div>
						<div className="global-commerce-controls">
							<div className="mb-3 flex items-center justify-between">
								<p className="text-xs text-white/50">{copy.marketsLabel}</p>
								{!reduced && (
									<Button
										type="button"
										variant="ghost"
										size="sm"
										shape="circle"
										className="global-commerce-pause"
										aria-label={story.paused ? copy.playLabel : copy.pauseLabel}
										onClick={story.toggle}
									>
										{story.paused ? <PlayIcon aria-hidden="true" size={16} /> : <PauseIcon aria-hidden="true" size={16} />}
									</Button>
								)}
							</div>
							<div role="group" aria-label={copy.marketsLabel} className="flex flex-wrap items-center gap-2">
								{GLOBAL_MARKETS.map((item, index) => (
									<Button
										key={item.id}
										type="button"
										variant="ghost"
										size="sm"
										className="global-commerce-market"
										aria-label={item.name}
										title={item.name}
										aria-pressed={story.active === index}
										aria-controls="global-commerce-example"
										onClick={() => story.select(index)}
									>
										<img src={item.flag} alt="" aria-hidden="true" width={28} height={21} className="global-commerce-flag" />
									</Button>
								))}
							</div>
						</div>
					</div>
					<div className="global-commerce-stage">
						<GlobalCommerceGlobe active={story.active} playing={story.playing} visible={visible && tabVisible} reducedMotion={reduced} />
						<div
							id="global-commerce-example"
							className="global-commerce-example"
							aria-live={story.paused || reduced ? 'polite' : 'off'}
							aria-atomic="true"
						>
							<div key={market.id} className="global-commerce-example-content">
								<div className="mb-4 flex items-center justify-between gap-3 text-xs">
									<span className="text-white/50">{copy.exampleLabel}</span>
									<span className="flex items-center gap-2 text-white/85">
										<span className="global-commerce-status" />
										{market.shortName}
									</span>
								</div>
								<div className="flex items-center gap-4">
									<img
										src={market.image}
										alt={market.imageAlt}
										width={80}
										height={80}
										loading="lazy"
										className="size-[72px] shrink-0 rounded-xl object-cover"
									/>
									<div className="min-w-0">
										<p className="mb-1 text-xs text-white/50">{market.category}</p>
										<p className="text-lg leading-tight font-medium text-white" lang={market.lang} dir="auto">
											{market.product}
										</p>
										<p className="mt-2 text-xs text-white/60">{market.language}</p>
									</div>
								</div>
								<div className="global-commerce-agent">
									<SparkleIcon aria-hidden="true" size={18} className="shrink-0 text-[#f3a16e]" />
									<p>
										<span className="sr-only">{copy.agentLabel}: </span>
										{market.task}
									</p>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}
