import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { CheckIcon, MinusIcon } from '@phosphor-icons/react';
import { PLATFORM_FEE_LABEL, formatTemplatePrice } from '@/api-types';
import { ComingSoon } from '@/components/marketing/ComingSoon';
import { PlanLimits } from '@/components/marketing/PlanLimits';
import { CapabilityTag } from '@/components/public-site/CapabilityTag';
import { PlanPrice } from '@/components/public-site/PlanPrice';
import { Eyebrow, HEADING_SECTION, LEAD, PillLink } from '@/components/public-site/primitives';
import { PublicFaq } from '@/components/public-site/PublicFaq';
import { PageMeta } from '@/components/public-site/solution-page';
import { usePublicPlan } from '@/hooks/use-public-plan';
import { PLANS, PLAN_COMPARISON, formatCredits, liveStoresLabel, type Plan, type PlanCell } from '@/lib/plans';
import { formatCents, sellerKeepsTable } from '@/lib/pricing';
import { cn } from '@/lib/utils';

function Feature({ children, tone = 'light' }: { children: ReactNode; tone?: 'light' | 'dark' }) {
	return (
		<li className={cn('flex items-start gap-3 text-[15px] font-light', tone === 'dark' ? 'text-white/85' : 'text-public-ink')}>
			<CheckIcon className={cn('mt-1 size-4 shrink-0', tone === 'dark' ? 'text-white' : 'text-public-blue')} weight="bold" aria-hidden />
			<span>{children}</span>
		</li>
	);
}

/** Shown only with the credits number it explains. */
function CreditRateNote() {
	const plan = usePublicPlan();
	if (plan.data?.aiCreditsPerDay == null) return null;
	return <p className="mt-2 text-sm text-public-muted">Each model uses credits at its own rate, so lighter models go further.</p>;
}

const CARD = 'flex flex-col rounded-[24px] p-8';
const CARD_LABEL = 'text-xs uppercase tracking-[0.02em]';

function PlanCard({ plan }: { plan: Plan }) {
	return (
		<article className={cn(CARD, 'ring ring-public-line')}>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h3 className={cn(CARD_LABEL, 'text-public-ink/80')}>{plan.name}</h3>
				{plan.status === 'coming-soon' && <ComingSoon />}
			</div>
			<PlanPrice plan={plan} className="mt-4 text-5xl font-light tracking-[-0.02em] text-public-ink" />
			{plan.monthlyCredits === null ? (
				<>
					<PlanLimits className="mt-3 text-sm text-public-muted" />
					<CreditRateNote />
				</>
			) : (
				<p className="mt-3 text-sm text-public-muted">
					{formatCredits(plan.monthlyCredits)} AI credits a month · {liveStoresLabel(plan.liveStores)}
				</p>
			)}
			<p className="mt-6 text-[15px] font-light text-public-ink">{plan.summary}</p>
			{plan.status === 'available' && (
				<>
					<ul className="mt-6 grid gap-3">
						<Feature>Change your store by chatting with the AI</Feature>
						<Feature>Live preview on desktop and phone</Feature>
						<Feature>Publish to Discover, or start from any free store there</Feature>
						<Feature>
							<span className="inline-flex flex-wrap items-center gap-2">
								Accept payments in your store <ComingSoon />
							</span>
						</Feature>
					</ul>
					<PillLink to="/#build" variant="blue" className="mt-8">
						Start building free
					</PillLink>
				</>
			)}
		</article>
	);
}

function Cell({ value }: { value: PlanCell }) {
	if (value === true) {
		return (
			<>
				<CheckIcon className="mx-auto size-4 text-public-blue" weight="bold" aria-hidden />
				<span className="sr-only">Included</span>
			</>
		);
	}
	if (value === false) {
		return (
			<>
				<MinusIcon className="mx-auto size-4 text-public-muted" aria-hidden />
				<span className="sr-only">Not included</span>
			</>
		);
	}
	return <>{value}</>;
}

function ComparisonRowView({ label, cells }: { label: string; cells: readonly PlanCell[] }) {
	return (
		<tr className="border-t border-public-line">
			<th scope="row" className="py-3 pr-4 text-left font-light text-public-ink">
				{label}
			</th>
			{cells.map((cell, index) => (
				<td key={PLANS[index].id} className="py-3 text-center text-public-ink">
					<Cell value={cell} />
				</td>
			))}
		</tr>
	);
}

function Comparison() {
	const plan = usePublicPlan();
	const freeCredits = plan.data?.aiCreditsPerDay == null ? 'Daily allowance' : `${formatCredits(plan.data.aiCreditsPerDay)} a day`;
	return (
		<section className="border-t border-public-line bg-white px-4 py-16 sm:px-6 sm:py-20">
			<div className="mx-auto max-w-[1248px]">
				<h2 className={cn(HEADING_SECTION, 'text-balance text-public-ink')}>Compare plans</h2>
				{/* Positioned, so the sr-only caption stays inside this scroll box. */}
				<div className="relative mt-10 overflow-x-auto">
					<table className="w-full min-w-[720px] text-[15px]">
						<caption className="sr-only">What each plan includes</caption>
						<thead>
							<tr>
								<td />
								{PLANS.map((entry) => (
									<th key={entry.id} scope="col" className="py-3 text-center font-normal text-public-ink">
										{entry.name}
									</th>
								))}
							</tr>
						</thead>
						{PLAN_COMPARISON.map((section) => (
							<tbody key={section.title}>
								<tr>
									<th scope="colgroup" colSpan={PLANS.length + 1} className="pt-8 pb-2 text-left font-normal">
										<span className="inline-flex flex-wrap items-center gap-2 text-public-ink">
											{section.title}
											{section.capability && <CapabilityTag id={section.capability} />}
										</span>
									</th>
								</tr>
								{section.capability === 'store-builder' && (
									<>
										<ComparisonRowView label="Live stores" cells={PLANS.map((entry) => liveStoresLabel(entry.liveStores))} />
										<ComparisonRowView
											label="AI credits"
											cells={PLANS.map((entry) => (entry.monthlyCredits === null ? freeCredits : `${formatCredits(entry.monthlyCredits)} a month`))}
										/>
									</>
								)}
								{section.rows.map((row) => (
									<ComparisonRowView key={row.label} label={row.label} cells={PLANS.map((entry) => row.cells[entry.id])} />
								))}
							</tbody>
						))}
					</table>
				</div>
				<p className="mt-6 text-sm text-public-muted">AI credits pay for building sites and for agents' work.</p>
			</div>
		</section>
	);
}

export default function PricingPage() {
	return (
		<div>
			<PageMeta
				title="Pricing"
				description={`Estori is free to build with, and paid plans are coming soon. Template sellers pay ${PLATFORM_FEE_LABEL} per sale.`}
			/>
			<section className="bg-public-charcoal px-4 pt-20 pb-24 text-center text-white sm:px-6 sm:pt-28 sm:pb-28">
				<Eyebrow tone="dark">Pricing</Eyebrow>
				<h1 className={cn(HEADING_SECTION, 'mx-auto mt-4 max-w-3xl text-balance')}>Plans for every stage of your store</h1>
				<p className={cn(LEAD, 'mx-auto mt-5 max-w-xl text-white/80')}>
					Start free today. Paid plans with live stores, agentic commerce and agents that help run your store are coming soon.
				</p>
			</section>
			<section className="bg-white px-4 py-16 sm:px-6 sm:py-20">
				<div className="mx-auto grid max-w-[1248px] gap-6 md:grid-cols-2 xl:grid-cols-4">
					{PLANS.map((plan) => (
						<PlanCard key={plan.id} plan={plan} />
					))}
				</div>
				<p className="mx-auto mt-10 max-w-[1248px] text-center text-xs text-public-muted">Prices are in US dollars.</p>
			</section>
			<Comparison />
			<section id="developers" className="scroll-mt-36 border-t border-public-line bg-white px-4 py-16 sm:px-6 sm:py-20">
				<div className="mx-auto max-w-[1248px]">
					<Eyebrow>For developers</Eyebrow>
					<h2 className={cn(HEADING_SECTION, 'mt-4 text-balance text-public-ink')}>Selling templates in Discover</h2>
					<div className="mt-10 grid gap-6 lg:grid-cols-2">
						{/* Positioned, so the table's absolute sr-only caption stays inside the page's own scroll. */}
						<article className={cn(CARD, 'relative bg-public-charcoal text-white')}>
							<h3 className={cn(CARD_LABEL, 'text-white/80')}>Sell</h3>
							<p className="mt-4 text-5xl font-light tracking-[-0.02em]">{PLATFORM_FEE_LABEL}</p>
							<p className="mt-3 text-sm text-white/70">per sale</p>
							<ul className="mt-8 grid gap-3">
								<Feature tone="dark">Choose a price. An Estori admin reviews it before buyers can use your store.</Feature>
								<Feature tone="dark">Buyers pay by card through Stripe. You receive the rest automatically, on Stripe's payout schedule.</Feature>
								<Feature tone="dark">You need a Stripe account and must be 18 or older.</Feature>
							</ul>
							<table className="mt-8 w-full text-left text-sm">
								<caption className="sr-only">What a seller keeps at each price</caption>
								<thead className="text-white/60">
									<tr>
										<th scope="col" className="py-2 font-normal">Price</th>
										<th scope="col" className="py-2 font-normal">Estori fee</th>
										<th scope="col" className="py-2 text-right font-normal">You keep</th>
									</tr>
								</thead>
								<tbody>
									{sellerKeepsTable().map((row) => (
										<tr key={row.priceCents} className="border-t border-white/15">
											<td className="py-2.5">{formatTemplatePrice(row.priceCents)}</td>
											<td className="py-2.5 text-white/70">{formatCents(row.feeCents)}</td>
											<td className="py-2.5 text-right">{formatCents(row.sellerCents)}</td>
										</tr>
									))}
								</tbody>
							</table>
						</article>
						<article className={cn(CARD, 'ring ring-public-line')}>
							<h3 className={cn(CARD_LABEL, 'text-public-ink/80')}>Buy a store design</h3>
							<p className="mt-4 text-5xl font-light tracking-[-0.02em] text-public-ink">One-time</p>
							<p className="mt-3 text-sm text-public-muted">the price on its page</p>
							<ul className="mt-8 grid gap-3">
								<Feature>Your own copy to adapt for your own store</Feature>
								<Feature>Keep editing it with the AI</Feature>
								<Feature>For your use only: it can't be republished or resold</Feature>
								<Feature>
									Refunded if it can't be used.{' '}
									<Link to="/refunds" className="underline underline-offset-4">
										Refund policy
									</Link>
								</Feature>
							</ul>
						</article>
					</div>
				</div>
			</section>
			<PublicFaq />
		</div>
	);
}
