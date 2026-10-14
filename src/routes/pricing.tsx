import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { CheckIcon } from '@phosphor-icons/react';
import { pageTitle } from '@/brand';
import { PLATFORM_FEE_LABEL, formatTemplatePrice } from '@/api-types';
import { PlanLimits } from '@/components/marketing/PlanLimits';
import { usePublicPlan } from '@/hooks/use-public-plan';
import { ComingSoon } from '@/components/marketing/ComingSoon';
import { formatCents, sellerKeepsTable } from '@/lib/pricing';

function Feature({ children }: { children: ReactNode }) {
	return (
		<li className="flex items-start gap-3 text-sm text-kumo-default">
			<CheckIcon className="mt-0.5 size-4 shrink-0 text-[var(--estori-action)]" weight="bold" />
			<span>{children}</span>
		</li>
	);
}

/** Shown only with the credits number it explains. */
function CreditRateNote() {
	const plan = usePublicPlan();
	if (plan.data?.aiCreditsPerDay == null) return null;
	return <p className="mt-2 text-sm text-kumo-subtle">Each model uses credits at its own rate, so lighter models go further.</p>;
}

export default function PricingPage() {
	return (
		<div>
			<title>{pageTitle('Pricing')}</title>
			<meta name="description" content={`Estori is free to build with. Sellers pay ${PLATFORM_FEE_LABEL} per sale.`} />
			<section className="mx-auto max-w-6xl px-4 pt-20 pb-12 text-center sm:px-6 sm:pt-28">
				<p className="text-xs font-medium uppercase tracking-[0.18em] text-kumo-subtle">Pricing</p>
				<h1 className="mx-auto mt-4 max-w-3xl text-5xl font-light tracking-[-0.025em] text-kumo-strong sm:text-6xl">
					Free to build. Pay only when you sell.
				</h1>
				<p className="mx-auto mt-5 max-w-xl text-lg font-light text-kumo-subtle">
					Build and publish stores at no cost. Estori earns only when one of your store designs sells.
				</p>
			</section>
			<section className="mx-auto grid max-w-6xl gap-6 px-4 pb-20 sm:px-6 lg:grid-cols-3">
				<article className="flex flex-col rounded-3xl bg-kumo-elevated p-8 ring ring-kumo-hairline">
					<h2 className="text-sm font-medium uppercase tracking-[0.14em] text-kumo-subtle">Build</h2>
					<p className="mt-4 text-5xl font-light tracking-tight text-kumo-strong">Free</p>
					<PlanLimits className="mt-3 text-sm text-kumo-subtle" />
					<CreditRateNote />
					<ul className="mt-8 grid gap-3">
						<Feature>Change your store by chatting with the AI</Feature>
						<Feature>Live preview on desktop and phone</Feature>
						<Feature>Publish to Discover, or start from any free store there</Feature>
						<Feature>
							<span className="inline-flex flex-wrap items-center gap-2">Accept payments in your store <ComingSoon /></span>
						</Feature>
					</ul>
				</article>
				<article className="flex flex-col rounded-3xl bg-[#070b16] p-8 text-white ring ring-white/10">
					<h2 className="text-sm font-medium uppercase tracking-[0.14em] text-white/60">Sell</h2>
					<p className="mt-4 text-5xl font-light tracking-tight">{PLATFORM_FEE_LABEL}</p>
					<p className="mt-3 text-sm text-white/60">per sale</p>
					<ul className="mt-8 grid gap-3 text-sm text-white/85">
						<li>Choose a price. An Estori admin reviews it before buyers can use your store.</li>
						<li>Buyers pay by card through Stripe. You receive the rest automatically, on Stripe's payout schedule.</li>
						<li>You need a Stripe account and must be 18 or older.</li>
					</ul>
					<table className="mt-8 w-full text-left text-sm">
						<thead className="text-white/50">
							<tr><th className="py-2 font-normal">Price</th><th className="py-2 font-normal">Estori fee</th><th className="py-2 text-right font-normal">You keep</th></tr>
						</thead>
						<tbody>
							{sellerKeepsTable().map((row) => (
								<tr key={row.priceCents} className="border-t border-white/10">
									<td className="py-2">{formatTemplatePrice(row.priceCents)}</td>
									<td className="py-2 text-white/70">{formatCents(row.feeCents)}</td>
									<td className="py-2 text-right">{formatCents(row.sellerCents)}</td>
								</tr>
							))}
						</tbody>
					</table>
				</article>
				<article className="flex flex-col rounded-3xl bg-kumo-elevated p-8 ring ring-kumo-hairline">
					<h2 className="text-sm font-medium uppercase tracking-[0.14em] text-kumo-subtle">Buy a store design</h2>
					<p className="mt-4 text-5xl font-light tracking-tight text-kumo-strong">One-time</p>
					<p className="mt-3 text-sm text-kumo-subtle">the price on its page</p>
					<ul className="mt-8 grid gap-3">
						<Feature>Your own copy to adapt for your own store</Feature>
						<Feature>Keep editing it with the AI</Feature>
						<Feature>For your use only: it can't be republished or resold</Feature>
						<Feature>
							Refunded if it can't be used. <Link to="/refunds" className="underline">Refund policy</Link>
						</Feature>
					</ul>
				</article>
			</section>
			<p className="mx-auto max-w-6xl px-4 pb-24 text-center text-xs text-kumo-subtle sm:px-6">Prices are in US dollars.</p>
		</div>
	);
}
