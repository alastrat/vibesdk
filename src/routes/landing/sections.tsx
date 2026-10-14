import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowRightIcon, CheckIcon } from '@phosphor-icons/react';
import { PLATFORM_FEE_LABEL, TEMPLATE_PRICE_OPTIONS_CENTS, formatTemplatePrice } from '@/api-types';
import { PlanLimits } from '@/components/marketing/PlanLimits';
import { ComingSoon } from '@/components/marketing/ComingSoon';

const PAID_PRICES = TEMPLATE_PRICE_OPTIONS_CENTS.filter((price) => price > 0).map(formatTemplatePrice).join(', ');

function Eyebrow({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
	return (
		<p className={`text-xs font-medium uppercase tracking-[0.18em] ${dark ? 'text-white/60' : 'text-kumo-subtle'}`}>{children}</p>
	);
}

/** Dark band with a brand-blue glow: the hero and the closing call to action. */
function DarkBand({ children, className = '' }: { children: ReactNode; className?: string }) {
	return (
		<div
			className={`relative overflow-hidden bg-[#070b16] text-white ${className}`}
			style={{ backgroundImage: 'radial-gradient(60% 55% at 50% 100%, color-mix(in oklab, var(--estori-action) 55%, transparent), transparent)' }}
		>
			{children}
		</div>
	);
}

const CREATOR_STEPS = [
	{ title: 'Build it', text: 'Describe the store and refine it by chatting until it is ready to sell.' },
	{ title: 'Set a price', text: `Choose ${PAID_PRICES}. An Estori admin reviews it, then your store is live in Discover with its own product page.` },
	{ title: 'Get paid', text: `Buyers pay by card through Stripe. You keep the price minus ${PLATFORM_FEE_LABEL}, paid out to your Stripe account.` },
] as const;

export function ForCreators() {
	return (
		<section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6 sm:pb-28">
			<div className="rounded-[2rem] bg-[var(--estori-action)] px-6 py-16 text-white sm:px-12 sm:py-20">
				<Eyebrow dark>For creators</Eyebrow>
				<h2 className="mt-4 max-w-3xl text-4xl font-light tracking-[-0.025em] text-balance sm:text-5xl">Design a store once. Earn every time it's used.</h2>
				<div className="mt-12 grid gap-6 md:grid-cols-3">
					{CREATOR_STEPS.map((step, index) => (
						<article key={step.title} className="rounded-3xl bg-white/10 p-6 ring ring-white/15">
							<p className="text-sm text-white/60">0{index + 1}</p>
							<h3 className="mt-3 text-xl font-normal">{step.title}</h3>
							<p className="mt-2 text-sm leading-relaxed text-white/80">{step.text}</p>
						</article>
					))}
				</div>
				<p className="mt-8 text-sm text-white/70">Sellers must be 18 or older and connect a Stripe account.</p>
			</div>
		</section>
	);
}

const STORE_FEATURES: ReadonlyArray<{ title: string; text: string; soon?: boolean }> = [
	{ title: 'Catalog and product pages', text: 'Products, variants, filters and detailed product pages, generated from your description.' },
	{ title: 'Cart and checkout flow', text: 'A cart, a checkout form and order confirmations your customers already know how to use.' },
	{ title: 'Order records', text: 'Your store can keep its orders in its own database, ready for you to review.' },
	{ title: 'Edit by chatting', text: 'Ask for a new section, a different style or more products, and the AI updates the live store.' },
	{ title: 'Desktop and phone preview', text: 'See every change on desktop and phone before you share it.' },
	{ title: 'Accept payments', text: 'Connect a payment provider and take real orders.', soon: true },
];

export function ForStoreOwners() {
	return (
		<section className="border-t border-kumo-line bg-kumo-recessed">
			<div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
				<div className="max-w-2xl">
					<Eyebrow>For your own store</Eyebrow>
					<h2 className="mt-4 text-4xl font-light tracking-[-0.025em] text-kumo-strong sm:text-5xl text-balance">Everything your store needs, from one description</h2>
					<p className="mt-4 text-lg font-light text-kumo-subtle">
						Start from scratch or from a store in Discover, then change anything by chatting.
					</p>
				</div>
				<div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{STORE_FEATURES.map((feature) => (
						<article key={feature.title} className="rounded-3xl bg-kumo-elevated p-7 ring ring-kumo-hairline">
							<div className="flex flex-wrap items-center gap-2">
								<h3 className="text-lg font-normal text-kumo-strong">{feature.title}</h3>
								{feature.soon && <ComingSoon />}
							</div>
							<p className="mt-2 text-sm leading-relaxed text-kumo-subtle">{feature.text}</p>
						</article>
					))}
				</div>
			</div>
		</section>
	);
}

export function PricingSummary() {
	return (
		<section className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
			<div className="grid gap-10 lg:grid-cols-[1fr_1fr] lg:items-center">
				<div>
					<Eyebrow>Pricing</Eyebrow>
					<h2 className="mt-4 text-4xl font-light tracking-[-0.025em] text-kumo-strong sm:text-5xl text-balance">Free to build. Pay only when you sell.</h2>
					<Link to="/pricing" className="mt-6 inline-flex items-center gap-1 text-sm text-[var(--estori-link)] hover:underline">
						See pricing <ArrowRightIcon className="size-4" />
					</Link>
				</div>
				<div className="grid gap-4 sm:grid-cols-2">
					<article className="rounded-3xl bg-kumo-elevated p-7 ring ring-kumo-hairline">
						<p className="text-sm uppercase tracking-[0.14em] text-kumo-subtle">Build</p>
						<p className="mt-3 text-4xl font-light text-kumo-strong">Free</p>
						<PlanLimits className="mt-3 text-sm text-kumo-subtle" />
					</article>
					<article className="rounded-3xl bg-[#070b16] p-7 text-white ring ring-white/10">
						<p className="text-sm uppercase tracking-[0.14em] text-white/60">Sell</p>
						<p className="mt-3 text-4xl font-light">{PLATFORM_FEE_LABEL}</p>
						<p className="mt-3 text-sm text-white/60">per sale, paid through Stripe</p>
					</article>
				</div>
			</div>
		</section>
	);
}

const FAQ: ReadonlyArray<{ question: string; answer: ReactNode }> = [
	{ question: 'Is Estori free?', answer: 'Yes. Building, editing and publishing are free within daily limits. Estori only earns a fee when you sell a store design.' },
	{ question: 'Can my store take payments?', answer: 'Not yet. Stores include a catalog, cart, checkout flow and order records, and built-in payments are coming soon.' },
	{ question: 'Who owns the store I build?', answer: 'You do. Keep editing it, keep it private, or publish it to Discover.' },
	{ question: 'Can I resell a store I bought?', answer: "No. A store you buy is yours to adapt for your own business, but it can't be republished or resold." },
	{ question: 'What does Estori charge sellers?', answer: `${PLATFORM_FEE_LABEL} per sale. You receive the rest through Stripe.` },
	{
		question: "What if a store I bought doesn't work?",
		answer: (
			<>
				If it can't be used, email us within 14 days and we'll fix it or refund you. See the{' '}
				<Link to="/refunds" className="underline">refund policy</Link>.
			</>
		),
	},
];

export function LandingFaq() {
	return (
		<section className="border-t border-kumo-line">
			<div className="mx-auto grid max-w-6xl gap-10 px-4 py-20 sm:px-6 sm:py-28 lg:grid-cols-[1fr_2fr]">
				<div>
					<Eyebrow>FAQ</Eyebrow>
					<h2 className="mt-4 text-4xl font-light tracking-[-0.025em] text-kumo-strong">Questions, answered</h2>
				</div>
				<div className="divide-y divide-kumo-line">
					{FAQ.map((item) => (
						<details key={item.question} className="group py-5">
							<summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-lg font-normal text-kumo-strong [&::-webkit-details-marker]:hidden">
								{item.question}
								<span className="text-kumo-subtle transition-transform group-open:rotate-45" aria-hidden>+</span>
							</summary>
							<p className="mt-3 text-sm leading-relaxed text-kumo-subtle">{item.answer}</p>
						</details>
					))}
				</div>
			</div>
		</section>
	);
}

export function ClosingCta() {
	return (
		<section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6 sm:pb-28">
			<DarkBand className="rounded-[2rem] ring ring-white/10">
				<div className="px-6 py-20 text-center sm:px-12">
					<h2 className="mx-auto max-w-3xl text-4xl font-light tracking-[-0.025em] text-balance sm:text-6xl">Your next store starts with a sentence.</h2>
					<div className="mt-10 flex flex-wrap justify-center gap-3">
						<a href="#build" className="rounded-full bg-white px-6 py-3 text-sm font-medium text-[#070b16] hover:bg-white/90">Start building</a>
						<Link to="/pricing" className="rounded-full px-6 py-3 text-sm text-white ring ring-white/30 hover:ring-white/60">View pricing</Link>
					</div>
					<ul className="mx-auto mt-10 flex max-w-xl flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-white/70">
						<li className="inline-flex items-center gap-1.5"><CheckIcon className="size-4" /> Free to build</li>
						<li className="inline-flex items-center gap-1.5"><CheckIcon className="size-4" /> Live preview</li>
						<li className="inline-flex items-center gap-1.5"><CheckIcon className="size-4" /> Sell in Discover</li>
					</ul>
				</div>
			</DarkBand>
		</section>
	);
}
