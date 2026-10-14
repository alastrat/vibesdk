import { PLATFORM_FEE_LABEL } from '@/api-types';
import { PlanLimits } from '@/components/marketing/PlanLimits';
import { BlurFade } from '@/components/magicui/blur-fade';
import { Eyebrow, HEADING_SECTION, LEAD, PillLink, TextLink } from '@/components/public-site/primitives';
import { cn } from '@/lib/utils';

export function PricingSummary() {
	return (
		<section className="border-t border-public-line bg-white px-4 py-20 sm:px-6 sm:py-28">
			<BlurFade inView className="mx-auto grid max-w-[1248px] gap-10 lg:grid-cols-2 lg:items-center">
				<div>
					<Eyebrow>Pricing</Eyebrow>
					<h2 className={cn(HEADING_SECTION, 'mt-4 text-balance text-public-ink')}>Free to build. Pay only when you sell.</h2>
					<TextLink to="/pricing" className="mt-6">
						See pricing
					</TextLink>
				</div>
				<div className="grid gap-4 sm:grid-cols-2">
					<article className="rounded-[24px] p-7 ring ring-public-line">
						<p className="text-xs uppercase tracking-[0.02em] text-public-ink/80">Build</p>
						<p className="mt-3 text-4xl font-light tracking-[-0.02em] text-public-ink">Free</p>
						<PlanLimits className="mt-3 text-sm text-public-muted" />
					</article>
					<article className="rounded-[24px] bg-public-charcoal p-7 text-white">
						<p className="text-xs uppercase tracking-[0.02em] text-white/80">Sell</p>
						<p className="mt-3 text-4xl font-light tracking-[-0.02em]">{PLATFORM_FEE_LABEL}</p>
						<p className="mt-3 text-sm text-white/70">per sale, paid through Stripe</p>
					</article>
				</div>
			</BlurFade>
		</section>
	);
}

export function ClosingPanel() {
	return (
		<section className="bg-white px-3 pb-6 sm:px-6">
			<div className="mx-auto max-w-[1392px] rounded-[25px] bg-public-charcoal px-6 py-20 text-center text-white sm:py-24">
				<h2 className={cn(HEADING_SECTION, 'mx-auto max-w-3xl text-balance')}>Your next store starts with a sentence.</h2>
				<p className={cn(LEAD, 'mx-auto mt-5 max-w-xl text-white/80')}>Describe it, watch it build, and publish it when it's ready.</p>
				<div className="mt-10 flex flex-wrap justify-center gap-3">
					<PillLink to="/#build" variant="white">
						Start building
					</PillLink>
					<PillLink to="/pricing" variant="outline-on-dark">
						View pricing
					</PillLink>
				</div>
			</div>
		</section>
	);
}
