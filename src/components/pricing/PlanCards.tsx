import { useId, useState, type ReactNode } from 'react';
import { BuildingsIcon, CheckIcon, CoinsIcon, CrownIcon, StorefrontIcon, type Icon } from '@phosphor-icons/react';
import { ComingSoon } from '@/components/marketing/ComingSoon';
import { PlanLimits } from '@/components/marketing/PlanLimits';
import { CapabilityTag } from '@/components/public-site/CapabilityTag';
import { PillLink } from '@/components/public-site/primitives';
import type { CapabilityId } from '@/lib/capabilities';
import { PREMIUM_TIERS, formatCredits, formatUsd, planById, type PlanId } from '@/lib/plans';
import { contactPath } from '@/lib/contact';

function Feature({ children, capability }: { children: ReactNode; capability?: CapabilityId }) {
	return (
		<li className="flex items-start gap-3 text-[15px] font-light text-public-ink">
			<CheckIcon className="mt-1 size-4 shrink-0 text-public-blue" weight="bold" aria-hidden />
			<span className="inline-flex flex-wrap items-center gap-2">
				{children}
				{capability && <CapabilityTag id={capability} />}
			</span>
		</li>
	);
}

function PlanHeading({ id, icon: Glyph, children }: { id: PlanId; icon: Icon; children?: ReactNode }) {
	const plan = planById(id);
	return (
		<>
			<div className="flex flex-wrap items-center gap-3">
				<h3 className="flex items-center gap-2.5 text-2xl font-normal text-public-ink">
					<Glyph className="size-6 text-public-blue" aria-hidden />
					{plan.name}
				</h3>
				{children}
			</div>
			<p className="mt-2 text-[15px] font-light text-public-muted">{plan.tagline}</p>
		</>
	);
}

function Price({ cents }: { cents: number }) {
	return (
		<p className="mt-8 text-5xl font-light tracking-[-0.02em] text-public-ink">
			{formatUsd(cents)}
			<span className="text-base font-normal tracking-normal text-public-muted"> / month</span>
		</p>
	);
}

function BasicPlan() {
	return (
		<article className="flex flex-col p-8 sm:p-10">
			<PlanHeading id="basic" icon={StorefrontIcon} />
			<Price cents={0} />
			<p className="mt-1 text-sm text-public-muted">Free forever. No credit card.</p>
			<div className="mt-6 flex min-h-12 items-center gap-3 rounded-xl bg-[#f5f6f8] px-4 py-3 text-sm text-public-ink">
				<CoinsIcon className="size-5 shrink-0 text-public-blue" aria-hidden />
				<PlanLimits className="text-sm" fallback="A daily allowance of AI credits" />
			</div>
			<PillLink to="/signup" variant="blue" className="mt-6">
				Start building free
			</PillLink>
			<ul className="mt-8 grid gap-3 border-t border-dashed border-public-line pt-8">
				<Feature>Build and change stores just by asking</Feature>
				<Feature>Live preview on desktop and phone</Feature>
				<Feature>Start from any template in Discover</Feature>
				<Feature>Publish your stores and sell them as templates</Feature>
			</ul>
		</article>
	);
}

/** Premium with its credit pool: choosing a bigger pool updates the price. */
function PremiumPlan() {
	const [credits, setCredits] = useState(PREMIUM_TIERS[0].credits);
	const selectId = useId();
	const tier = PREMIUM_TIERS.find((entry) => entry.credits === credits) ?? PREMIUM_TIERS[0];
	return (
		<article className="flex flex-col p-8 sm:p-10">
			<PlanHeading id="premium" icon={CrownIcon}>
				<ComingSoon />
			</PlanHeading>
			<Price cents={tier.priceCents} />
			<p className="mt-1 text-sm text-public-muted">Billed monthly. Change your credits any time.</p>
			<label htmlFor={selectId} className="sr-only">
				Monthly AI credits
			</label>
			<div className="relative mt-6">
				<CoinsIcon className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-public-blue" aria-hidden />
				<select
					id={selectId}
					value={credits}
					onChange={(event) => setCredits(Number(event.target.value))}
					className="min-h-12 w-full cursor-pointer appearance-none rounded-xl bg-[#f5f6f8] py-3 pr-10 pl-12 text-sm text-public-ink ring-1 ring-transparent transition-shadow outline-none hover:ring-public-line focus-visible:ring-2 focus-visible:ring-public-blue"
				>
					{PREMIUM_TIERS.map((entry) => (
						<option key={entry.credits} value={entry.credits}>
							{formatCredits(entry.credits)} AI credits a month
						</option>
					))}
				</select>
				<span aria-hidden className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-public-muted">
					▾
				</span>
			</div>
			<PillLink to={contactPath('premium', tier.credits)} variant="charcoal" className="mt-6">
				Get Premium
			</PillLink>
			<p className="mt-3 text-center text-xs text-public-muted">Paid plans are coming soon. Tell us what you need and we'll set you up as they open.</p>
			<ul className="mt-8 grid gap-3 border-t border-dashed border-public-line pt-8">
				<Feature>Everything in Basic, plus a monthly pool of AI credits</Feature>
				<Feature capability="agentic-commerce">Get recommended by AI assistants</Feature>
				<Feature capability="operations-agents">Store assistants</Feature>
				<Feature capability="personalized-shopping">Personalized shopping</Feature>
				<Feature>Priority email support</Feature>
			</ul>
		</article>
	);
}

/** 1Password's business pricing: two plans side by side in one frame, Enterprise on its own band below. */
export function PlanCards() {
	return (
		<section aria-labelledby="plans-title" className="bg-white px-4 pt-16 pb-6 sm:px-6 sm:pt-20">
			<h2 id="plans-title" className="sr-only">
				Plans
			</h2>
			<div className="mx-auto grid max-w-[1248px] overflow-hidden rounded-[25px] ring-1 ring-[#c9dbff] md:grid-cols-2 md:divide-x md:divide-[#c9dbff] max-md:divide-y max-md:divide-[#c9dbff]">
				<BasicPlan />
				<PremiumPlan />
			</div>
			<EnterpriseBand />
			<p className="mx-auto mt-6 max-w-[1248px] text-center text-xs text-public-muted">Prices are in US dollars and exclude any applicable taxes.</p>
		</section>
	);
}

function EnterpriseBand() {
	const plan = planById('enterprise');
	return (
		<article className="mx-auto mt-6 flex max-w-[1248px] flex-col gap-6 rounded-[25px] bg-public-charcoal p-8 text-white sm:flex-row sm:items-center sm:justify-between sm:p-10">
			<div>
				<h3 className="flex items-center gap-2.5 text-2xl font-normal">
					<BuildingsIcon className="size-6 text-[#9cc2ff]" aria-hidden />
					{plan.name}
				</h3>
				<p className="mt-2 max-w-2xl text-[15px] font-light text-white/80">
					{plan.tagline} Custom credit volume, invoiced billing and a named contact for teams running many stores.
				</p>
			</div>
			<PillLink to={contactPath('enterprise')} variant="white" className="shrink-0">
				Talk to sales
			</PillLink>
		</article>
	);
}
