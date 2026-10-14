import { useRef, type ReactNode, type Ref } from 'react';
import { formatTemplatePrice } from '@/api-types';
import { AnimatedBeam } from '@/components/magicui/animated-beam';
import { NumberTicker } from '@/components/magicui/number-ticker';
import { Eyebrow, HEADING_SECTION, LEAD, PillLink, pillClass } from '@/components/public-site/primitives';
import { EXAMPLE_SALE_CENTS, sellerKeepsCents } from '@/lib/pricing';
import { cn } from '@/lib/utils';

function FlowNode({ ref, label, value }: { ref: Ref<HTMLDivElement>; label: string; value: ReactNode }) {
	return (
		<div ref={ref} className="relative z-10 rounded-[14px] bg-white/12 px-4 py-3 text-left ring ring-white/35 backdrop-blur-sm">
			<p className="text-[13px] text-white/85">{label}</p>
			<p className="mt-0.5 text-xl font-light">{value}</p>
		</div>
	);
}

/** The creator story on 1Password's blue panel: a sale flowing from Discover to the seller. */
export function CreatorsPanel() {
	const containerRef = useRef<HTMLDivElement>(null);
	const storeRef = useRef<HTMLDivElement>(null);
	const discoverRef = useRef<HTMLDivElement>(null);
	const buyerRef = useRef<HTMLDivElement>(null);
	const keepRef = useRef<HTMLDivElement>(null);
	const price = formatTemplatePrice(EXAMPLE_SALE_CENTS);
	const keeps = sellerKeepsCents(EXAMPLE_SALE_CENTS) / 100;
	const beam = { containerRef, gradientStartColor: '#ffffff', gradientStopColor: '#bcd4ff', pathColor: '#ffffff', className: 'hidden sm:block' };

	return (
		<section className="bg-white px-3 pt-6 sm:px-6">
			<div id="creators" className="mx-auto max-w-[1392px] scroll-mt-36 rounded-[25px] bg-public-blue px-6 py-16 text-center text-white sm:px-14 sm:py-20">
				<Eyebrow tone="dark">For creators</Eyebrow>
				<h2 className={cn(HEADING_SECTION, 'mx-auto mt-4 max-w-3xl text-balance')}>Design a store once. Earn every time it's used.</h2>
				<p className={cn(LEAD, 'mx-auto mt-5 max-w-2xl text-white/90')}>
					Publish to Discover, set a price, and get paid through Stripe when someone starts from your store.
				</p>
				<div ref={containerRef} className="relative mx-auto mt-12 grid max-w-3xl grid-cols-2 gap-6 sm:grid-cols-4">
					<FlowNode ref={storeRef} label="Your store" value="Published" />
					<FlowNode ref={discoverRef} label="Discover" value={price} />
					<FlowNode ref={buyerRef} label="A buyer" value={`Pays ${price}`} />
					<FlowNode ref={keepRef} label="You keep" value={<>$<NumberTicker value={keeps} decimalPlaces={2} /></>} />
					<AnimatedBeam {...beam} fromRef={storeRef} toRef={discoverRef} />
					<AnimatedBeam {...beam} fromRef={discoverRef} toRef={buyerRef} delay={0.6} />
					<AnimatedBeam {...beam} fromRef={buyerRef} toRef={keepRef} delay={1.2} />
				</div>
				<div className="mt-10 flex flex-wrap justify-center gap-3">
					<a href="#build" className={pillClass('charcoal')}>
						Start selling
					</a>
					<PillLink to="/pricing" variant="outline-on-dark">
						How selling works
					</PillLink>
				</div>
				<p className="mt-6 text-sm text-white/85">Sellers must be 18 or older and connect a Stripe account.</p>
			</div>
		</section>
	);
}
