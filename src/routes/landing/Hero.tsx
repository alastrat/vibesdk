import { Link } from 'react-router';
import { ArrowRightIcon, CheckCircleIcon } from '@phosphor-icons/react';
import { BuildBox } from '@/components/build-box';
import { AnimatedList } from '@/components/magicui/animated-list';
import { BorderBeam } from '@/components/magicui/border-beam';
import { Safari } from '@/components/magicui/safari';
import { Eyebrow, HEADING_HERO, LEAD } from '@/components/public-site/primitives';
import type { ShowcaseStore } from '@/lib/showcase';
import { cn } from '@/lib/utils';
import { StoreLogos } from './StoreLogos';

const STORE_PHRASES = ['a specialty coffee store', 'a handmade ceramics shop', 'a streetwear store', 'a plant shop with local delivery', 'a vintage camera store'];

const DEMO_PROMPT = 'Build a specialty coffee store with weekly roasts and subscriptions';
const BUILD_STEPS = ['Catalog with 12 roasts', 'Product pages and filters', 'Cart and checkout flow', 'Order records', 'Deployed to a live preview'] as const;

/** A store built on Estori, bundled so the hero never depends on what Discover holds. */
export const HERO_STORE_IMAGE = '/marketing/hero-store.jpg';

export function Hero({ stores }: { stores: readonly ShowcaseStore[] }) {
	return (
		<section className="overflow-x-clip bg-public-charcoal text-white">
			{/* The border beam's light overhangs the box at its corners; the section clips it sideways so phones never scroll. */}
			<div className="mx-auto max-w-[1248px] px-4 pt-20 text-center sm:px-6 sm:pt-28">
				<Eyebrow tone="dark">The agentic commerce platform</Eyebrow>
				<h1 className={cn(HEADING_HERO, 'mx-auto mt-4 max-w-5xl text-balance')}>Build your store with AI. Sell wherever shoppers ask AI.</h1>
				<p className={cn(LEAD, 'mx-auto mt-6 max-w-2xl text-pretty text-white/80')}>
					Describe your brand and Estori builds and deploys a complete store: catalog, cart, checkout flow and order records. Agentic commerce,
					operations agents and personalized shopping are coming soon to every store.
				</p>
				{/* The frame resets the band's white text so the box's own controls stay readable. */}
				<div
					id="build"
					className="app-theme-scope relative mx-auto mt-10 max-w-2xl scroll-mt-36 rounded-[24px] bg-white/10 p-1.5 text-left text-kumo-default shadow-2xl shadow-black/40 ring ring-white/15"
				>
					<BuildBox placeholder="Build " placeholderPhrases={STORE_PHRASES} />
					<BorderBeam size={140} duration={8} colorFrom="#6ea8ff" colorTo="#ffffff" borderWidth={2} />
				</div>
				<div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-white/75">
					<span>Free to build. No credit card.</span>
					<Link to="/discover" className="inline-flex items-center gap-1 text-white underline underline-offset-[5px]">
						Browse stores in Discover <ArrowRightIcon className="size-4" aria-hidden />
					</Link>
				</div>
			</div>
			<StoreLogos stores={stores} />
			<BuilderDemo />
		</section>
	);
}

/** 1Password's product frame, Estori-style: a chat whose build steps arrive one by one beside the store they make. */
function BuilderDemo() {
	return (
		<div className="mt-14 px-3 sm:mt-20 sm:px-6">
			<div
				role="img"
				aria-label="Estori building a coffee store from one sentence: the chat on the left, the live store on the right"
				className="mx-auto max-w-[1392px] overflow-hidden rounded-[25px] bg-[linear-gradient(180deg,#1f3f9a_0%,#2f6fe8_55%,#78a6ff_100%)] px-4 pt-8 sm:px-10 sm:pt-12"
			>
				<div className="mx-auto grid max-w-[1152px] overflow-hidden rounded-t-[14px] bg-white text-left text-[#1e2a3b] shadow-[0_-10px_40px_rgba(0,0,0,0.25)] md:grid-cols-[280px_1fr]">
					<div className="grid content-start gap-3 border-b border-public-line p-5 text-sm md:border-r md:border-b-0">
						<p className="rounded-xl bg-[#eef4ff] px-3 py-2.5">{DEMO_PROMPT}</p>
						{/* Reserves the finished list's height so the demo doesn't grow on phones while steps arrive. */}
						<AnimatedList delay={900} newestFirst={false} className="min-h-28 items-stretch gap-2">
							{BUILD_STEPS.map((step) => (
								<p key={step} className="flex items-center gap-2">
									<CheckCircleIcon weight="fill" className="size-4 shrink-0 text-[#16a34a]" aria-hidden />
									{step}
								</p>
							))}
						</AnimatedList>
					</div>
					<div className="bg-[#f7f8fa] p-3 sm:p-4">
						<Safari url="Live preview" imageSrc={HERO_STORE_IMAGE} className="w-full" />
					</div>
				</div>
			</div>
		</div>
	);
}
