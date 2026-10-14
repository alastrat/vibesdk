import type { ReactNode } from 'react';
import { AnimatedList } from '@/components/magicui/animated-list';
import { BlurFade } from '@/components/magicui/blur-fade';
import { NumberTicker } from '@/components/magicui/number-ticker';
import { TypingAnimation } from '@/components/magicui/typing-animation';
import { ComingSoon } from '@/components/marketing/ComingSoon';
import { Eyebrow, HEADING_CARD, HEADING_SECTION, LEAD, TextLink } from '@/components/public-site/primitives';
import { cn } from '@/lib/utils';

function MiniCard({ children }: { children: ReactNode }) {
	return <div className="w-full rounded-xl bg-white p-3 text-left text-[11px] text-[#1e2a3b] shadow-[0_6px_18px_rgba(0,0,0,0.12)]">{children}</div>;
}

const PRODUCT_SWATCHES = [
	'from-[#f4e3cf] to-[#d9a77c]',
	'from-[#dbe6dc] to-[#7f9f86]',
	'from-[#f4e3cf] to-[#d9a77c]',
	'from-[#dbe6dc] to-[#7f9f86]',
	'from-[#e6e1f4] to-[#9a8fc9]',
	'from-[#f4e3cf] to-[#d9a77c]',
] as const;

function CatalogIllustration() {
	return (
		<MiniCard>
			<p className="mb-2">Catalog · 12 products</p>
			<div className="grid grid-cols-3 gap-1.5">
				{PRODUCT_SWATCHES.map((swatch, index) => (
					<span key={index} className={cn('h-10 rounded-md bg-gradient-to-br', swatch)} />
				))}
			</div>
		</MiniCard>
	);
}

function CartIllustration() {
	return (
		<MiniCard>
			<p>Your cart · 3 items</p>
			<p className="mt-1 text-[22px] font-light">
				$<NumberTicker value={54} decimalPlaces={2} />
			</p>
			<span className="mt-2 block rounded-full bg-public-blue py-1.5 text-center text-white">Checkout</span>
		</MiniCard>
	);
}

const ORDERS = [
	{ id: '#1042', item: 'Ethiopia Guji', total: '$18' },
	{ id: '#1043', item: 'House blend', total: '$36' },
	{ id: '#1044', item: 'Subscription', total: '$32' },
] as const;

function OrdersIllustration() {
	return (
		<MiniCard>
			<p className="mb-1">Orders</p>
			<AnimatedList delay={1200} className="items-stretch gap-0">
				{ORDERS.map((order) => (
					<p key={order.id} className="flex justify-between border-b border-[#f0f0f0] py-1.5">
						<span>
							{order.id} · {order.item}
						</span>
						<span>{order.total}</span>
					</p>
				))}
			</AnimatedList>
		</MiniCard>
	);
}

function ChatIllustration() {
	return (
		<MiniCard>
			<p className="rounded-lg bg-[#eef4ff] px-2.5 py-2">
				<TypingAnimation className="leading-normal tracking-normal" duration={40}>
					Make the hero warmer and add a subscription plan
				</TypingAnimation>
			</p>
			<p className="mt-2 text-[#5b6576]">Updating the live store…</p>
		</MiniCard>
	);
}

const FEATURES: ReadonlyArray<{ title: string; text: string; illustration: ReactNode; link: { to: string; label: string } }> = [
	{
		title: 'Catalog and product pages',
		text: 'Products, variants, filters and detailed product pages, generated from your description.',
		illustration: <CatalogIllustration />,
		link: { to: '/discover', label: 'See stores in Discover' },
	},
	{
		title: 'Cart and checkout flow',
		text: 'A cart, a checkout form and order confirmations your customers already know how to use.',
		illustration: <CartIllustration />,
		link: { to: '/#build', label: 'Start building' },
	},
	{
		title: 'Order records',
		text: 'Your store can keep its orders in its own database, ready for you to review.',
		illustration: <OrdersIllustration />,
		link: { to: '/#build', label: 'Start building' },
	},
	{
		title: 'Edit by chatting',
		text: 'Ask for a new section, a different style or more products, and the AI updates the live store.',
		illustration: <ChatIllustration />,
		link: { to: '/#build', label: 'Try it' },
	},
];

/** What every store gets, on 1Password's white cards with small live illustrations. */
export function Features() {
	return (
		<section className="bg-public-charcoal px-4 pt-20 pb-24 text-white sm:px-6 sm:pt-28">
			<div className="mx-auto max-w-[1248px]">
				<Eyebrow tone="dark">Estori store builder</Eyebrow>
				<h2 className={cn(HEADING_SECTION, 'mt-4 max-w-3xl text-balance')}>What Estori builds today</h2>
				<p className={cn(LEAD, 'mt-5 max-w-2xl text-white/80')}>Start from scratch or from a store in Discover, then change anything by chatting.</p>
				<TextLink to="/#build" tone="dark" className="mt-6">
					Start building
				</TextLink>
				<BlurFade inView className="mt-14 grid gap-x-4 gap-y-12 sm:grid-cols-2 lg:grid-cols-4">
					{FEATURES.map((feature) => (
						<article key={feature.title}>
							<div aria-hidden className="flex h-[220px] items-center justify-center rounded-[24px] bg-white p-5">
								{feature.illustration}
							</div>
							<h3 className={cn(HEADING_CARD, 'mt-6')}>{feature.title}</h3>
							<p className="mt-3 text-base leading-relaxed font-light text-white/80">{feature.text}</p>
							<TextLink to={feature.link.to} tone="dark" className="mt-4">
								{feature.link.label}
							</TextLink>
						</article>
					))}
				</BlurFade>
				<p className="mt-14 flex flex-wrap items-center gap-3 text-sm text-white/75">
					Accept payments in your store <ComingSoon tone="dark" />
				</p>
			</div>
		</section>
	);
}
