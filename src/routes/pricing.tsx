import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { CheckIcon } from '@phosphor-icons/react';
import { pageTitle } from '@/brand';
import { PLATFORM_FEE_LABEL, formatTemplatePrice } from '@/api-types';
import { ComingSoon } from '@/components/marketing/ComingSoon';
import { PlanLimits } from '@/components/marketing/PlanLimits';
import { PublicFaq } from '@/components/public-site/PublicFaq';
import { Eyebrow, HEADING_SECTION, LEAD } from '@/components/public-site/primitives';
import { usePublicPlan } from '@/hooks/use-public-plan';
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

export default function PricingPage() {
	return (
		<div>
			<title>{pageTitle('Pricing')}</title>
			<meta name="description" content={`Estori is free to build with. Sellers pay ${PLATFORM_FEE_LABEL} per sale.`} />
			<section className="bg-public-charcoal px-4 pt-20 pb-24 text-center text-white sm:px-6 sm:pt-28 sm:pb-28">
				<Eyebrow tone="dark">Pricing</Eyebrow>
				<h1 className={cn(HEADING_SECTION, 'mx-auto mt-4 max-w-3xl text-balance')}>Free to build. Pay only when you sell.</h1>
				<p className={cn(LEAD, 'mx-auto mt-5 max-w-xl text-white/80')}>
					Build and publish stores at no cost. Estori earns only when one of your store designs sells.
				</p>
			</section>
			<section className="bg-white px-4 py-16 sm:px-6 sm:py-20">
				<div className="mx-auto grid max-w-[1248px] gap-6 lg:grid-cols-3">
					<article className={cn(CARD, 'ring ring-public-line')}>
						<h2 className={cn(CARD_LABEL, 'text-public-ink/80')}>Build</h2>
						<p className="mt-4 text-5xl font-light tracking-[-0.02em] text-public-ink">Free</p>
						<PlanLimits className="mt-3 text-sm text-public-muted" />
						<CreditRateNote />
						<ul className="mt-8 grid gap-3">
							<Feature>Change your store by chatting with the AI</Feature>
							<Feature>Live preview on desktop and phone</Feature>
							<Feature>Publish to Discover, or start from any free store there</Feature>
							<Feature>
								<span className="inline-flex flex-wrap items-center gap-2">
									Accept payments in your store <ComingSoon />
								</span>
							</Feature>
						</ul>
					</article>
					<article className={cn(CARD, 'bg-public-charcoal text-white')}>
						<h2 className={cn(CARD_LABEL, 'text-white/80')}>Sell</h2>
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
						<h2 className={cn(CARD_LABEL, 'text-public-ink/80')}>Buy a store design</h2>
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
				<p className="mx-auto mt-10 max-w-[1248px] text-center text-xs text-public-muted">Prices are in US dollars.</p>
			</section>
			<PublicFaq />
		</div>
	);
}
