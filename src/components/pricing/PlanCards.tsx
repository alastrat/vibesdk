import type { ReactNode } from 'react';
import { BuildingsIcon, CheckIcon, CoinsIcon, CrownIcon, RocketLaunchIcon, StorefrontIcon, type Icon } from '@phosphor-icons/react';
import { PLAN_LIMITS, PLAN_PRICES_CENTS, type PaidPlanId } from '@/api-types';
import { PlanButton } from '@/components/billing/PlanButton';
import { ComingSoon } from '@/components/marketing/ComingSoon';
import { PlanLimits } from '@/components/marketing/PlanLimits';
import { CapabilityTag } from '@/components/public-site/CapabilityTag';
import { PillLink } from '@/components/public-site/primitives';
import { StartBuildingButton } from '@/components/public-site/StartBuildingButton';
import { useBillingOn } from '@/hooks/use-billing';
import type { CapabilityId } from '@/lib/capabilities';
import { contactPath } from '@/lib/contact';
import { formatCredits, formatUsd, limitFeatures, planById, type PlanId } from '@/lib/plans';

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

/** The plan's credits, in the shaded line under the price. */
function Allowance({ children }: { children: ReactNode }) {
	return (
		<div className="mt-6 flex min-h-12 items-center gap-3 rounded-xl bg-[#f5f6f8] px-4 py-3 text-sm text-public-ink">
			<CoinsIcon className="size-5 shrink-0 text-public-blue" aria-hidden />
			{children}
		</div>
	);
}

const CARD = 'flex flex-col p-8 sm:p-10 md:p-7 lg:p-10';

function BasicPlan({ billing }: { billing: boolean }) {
	const { liveStores, storesLifetime } = PLAN_LIMITS.basic;
	return (
		<article className={CARD}>
			<PlanHeading id="basic" icon={StorefrontIcon} />
			<Price cents={0} />
			<p className="mt-1 text-sm text-public-muted">Free forever. No credit card.</p>
			<Allowance>
				<PlanLimits className="text-sm" fallback="A daily allowance of AI credits" />
			</Allowance>
			<StartBuildingButton variant="blue" className="mt-6" />
			<ul className="mt-8 grid gap-3 border-t border-dashed border-public-line pt-8">
				<Feature>Build and change stores just by asking</Feature>
				<Feature>Live preview on desktop and phone</Feature>
				<Feature>Start from any template in Discover</Feature>
				<Feature>Publish your stores and sell them as templates</Feature>
				{billing && liveStores !== null && storesLifetime !== null && (
					<Feature>
						{liveStores} live {liveStores === 1 ? 'store' : 'stores'}, {storesLifetime} stores in all
					</Feature>
				)}
			</ul>
		</article>
	);
}

/** What each paid plan adds to the one before it, from the shared limits. */
function PaidFeatures({ plan }: { plan: PaidPlanId }) {
	if (plan === 'pro') {
		return (
			<>
				<Feature>Everything in Basic</Feature>
				{limitFeatures('pro').map((line) => (
					<Feature key={line}>{line}</Feature>
				))}
			</>
		);
	}
	return (
		<>
			<Feature>Everything in Pro</Feature>
			{limitFeatures('premium', 'pro').map((line) => (
				<Feature key={line}>{line}</Feature>
			))}
			<Feature capability="agentic-commerce">Get recommended by AI assistants</Feature>
			<Feature capability="operations-agents">Store assistants</Feature>
			<Feature capability="personalized-shopping">Personalized shopping</Feature>
			<Feature>Priority email support</Feature>
		</>
	);
}

const PAID_ICONS: Record<PaidPlanId, Icon> = { pro: RocketLaunchIcon, premium: CrownIcon };

/** Pro or Premium: sold here once billing is on, and until then marked coming soon, leading to sales. */
function PaidPlan({ plan, billing }: { plan: PaidPlanId; billing: boolean }) {
	return (
		<article className={CARD}>
			<PlanHeading id={plan} icon={PAID_ICONS[plan]}>
				{!billing && <ComingSoon />}
			</PlanHeading>
			<Price cents={PLAN_PRICES_CENTS[plan]} />
			<p className="mt-1 text-sm text-public-muted">Billed monthly. Cancel any time.</p>
			<Allowance>{formatCredits(PLAN_LIMITS[plan].aiCredits)} AI credits a month</Allowance>
			{billing ? <PlanButton plan={plan} className="mt-6" /> : (
				<>
					<PillLink to={contactPath(plan)} variant="charcoal" className="mt-6">
						Get {planById(plan).name}
					</PillLink>
					<p className="mt-3 text-center text-xs text-public-muted">Paid plans are coming soon. Tell us what you need and we'll set you up as they open.</p>
				</>
			)}
			<ul className="mt-8 grid gap-3 border-t border-dashed border-public-line pt-8">
				<PaidFeatures plan={plan} />
			</ul>
		</article>
	);
}

/** 1Password's business pricing: Basic, Pro and Premium side by side in one frame, Enterprise on its own band below. */
export function PlanCards() {
	const billing = useBillingOn();
	return (
		<section aria-labelledby="plans-title" className="bg-white px-4 pt-16 pb-6 sm:px-6 sm:pt-20">
			<h2 id="plans-title" className="sr-only">
				Plans
			</h2>
			<div className="mx-auto grid max-w-[1248px] overflow-hidden rounded-[25px] ring-1 ring-[#c9dbff] md:grid-cols-3 md:divide-x md:divide-[#c9dbff] max-md:divide-y max-md:divide-[#c9dbff]">
				<BasicPlan billing={billing} />
				<PaidPlan plan="pro" billing={billing} />
				<PaidPlan plan="premium" billing={billing} />
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
