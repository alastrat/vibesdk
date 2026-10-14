import { ComingSoon } from '@/components/marketing/ComingSoon';
import { BlurFade } from '@/components/magicui/blur-fade';
import { PlanPrice } from '@/components/public-site/PlanPrice';
import { Eyebrow, HEADING_SECTION, LEAD, PillLink, TextLink } from '@/components/public-site/primitives';
import { PLANS } from '@/lib/plans';
import { cn } from '@/lib/utils';

export function PricingSummary() {
	return (
		<section className="border-t border-public-line bg-white px-4 py-20 sm:px-6 sm:py-28">
			<BlurFade inView className="mx-auto grid max-w-[1248px] gap-10">
				<div className="flex flex-wrap items-end justify-between gap-6">
					<div>
						<Eyebrow>Pricing</Eyebrow>
						<h2 className={cn(HEADING_SECTION, 'mt-4 text-balance text-public-ink')}>Start free. Grow into a plan.</h2>
					</div>
					<TextLink to="/pricing">See pricing</TextLink>
				</div>
				<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
					{PLANS.map((plan) => (
						<article key={plan.id} className="rounded-[24px] p-7 ring ring-public-line">
							<div className="flex flex-wrap items-center justify-between gap-2">
								<p className="text-xs uppercase tracking-[0.02em] text-public-ink/80">{plan.name}</p>
								{plan.status === 'coming-soon' && <ComingSoon />}
							</div>
							<PlanPrice plan={plan} className="mt-3 text-4xl font-light tracking-[-0.02em] text-public-ink" />
							<p className="mt-3 text-sm text-public-muted">{plan.summary}</p>
						</article>
					))}
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
