import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { CheckIcon } from '@phosphor-icons/react';
import { type BillingInterval, type PaidPlanId, PLAN_LIMITS, PLATFORM_FEE_LABEL, formatTemplatePrice } from '@/api-types';
import { ComparePlans } from '@/components/pricing/ComparePlans';
import { CreditsExplainer } from '@/components/pricing/CreditsExplainer';
import { PlanCards } from '@/components/pricing/PlanCards';
import { Eyebrow, HEADING_SECTION, LEAD } from '@/components/public-site/primitives';
import { PublicFaq } from '@/components/public-site/PublicFaq';
import { PageMeta } from '@/components/public-site/solution-page';
import { pricingFaq } from '@/content/positioning';
import { PRICING_PAGE } from '@/content/public-pages';
import { useBillingOn } from '@/hooks/use-billing';
import { useModelRates } from '@/hooks/use-model-rates';
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

const CARD = 'flex flex-col rounded-[24px] p-8';
const CARD_LABEL = 'text-xs uppercase tracking-[0.02em]';

/** 1Password's business pricing with Apollo's comparison and credits explainer, then template selling and questions. */
export default function PricingPage() {
	const billing = useBillingOn();
	const [interval, setInterval] = useState<BillingInterval>('month');
	const [credits, setCredits] = useState({ pro: PLAN_LIMITS.pro.aiCredits, premium: PLAN_LIMITS.premium.aiCredits });
	const chooseCredits = (plan: PaidPlanId, amount: number) => setCredits(current => ({ ...current, [plan]: amount }));
	const { rates } = useModelRates();
	return (
		<div>
			<PageMeta {...PRICING_PAGE} />
			<section className="bg-public-charcoal px-4 pt-20 pb-24 text-center text-white sm:px-6 sm:pt-28 sm:pb-28">
				<Eyebrow tone="dark">Pricing</Eyebrow>
				<h1 className={cn(HEADING_SECTION, 'mx-auto mt-4 max-w-3xl text-balance')}>Pricing that grows with your stores</h1>
				<p className={cn(LEAD, 'mx-auto mt-5 max-w-xl text-white/80')}>
					Start free on Basic. Move to Pro or Premium when you need more AI credits, or talk to us about Enterprise.
				</p>
			</section>
			<PlanCards interval={interval} onIntervalChange={setInterval} credits={credits} onCreditsChange={chooseCredits} />
			<ComparePlans billing={billing} interval={interval} credits={credits} />
			<CreditsExplainer />
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
											<th scope="row" className="py-2.5 font-normal">{formatTemplatePrice(row.priceCents)}</th>
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
			<PublicFaq leading={pricingFaq(billing, rates)} />
		</div>
	);
}
