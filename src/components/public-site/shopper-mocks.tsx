import { useEffect, useState, type ReactNode, type Ref } from 'react';
import {
	BackpackIcon,
	CoffeeBeanIcon,
	CompassIcon,
	DropIcon,
	FlowerLotusIcon,
	FunnelSimpleIcon,
	JarIcon,
	MagnifyingGlassIcon,
	PersonSimpleTaiChiIcon,
	ShoppingBagIcon,
	SneakerIcon,
	SockIcon,
	SparkleIcon,
	TentIcon,
	WavesIcon,
	type Icon,
} from '@phosphor-icons/react';
import type { ShopperCardId } from '@/content/positioning';
import { useStory } from '@/hooks/use-story';
import { cn } from '@/lib/utils';

/** A white store window rising from the bottom of the card's picture; the card's edge cuts it off, as on 1Password. */
function ShopWindow({ storyRef, children }: { storyRef: Ref<HTMLDivElement>; children: ReactNode }) {
	return (
		<div
			ref={storyRef}
			className="mx-auto h-full max-w-[440px] overflow-hidden rounded-t-[18px] bg-white px-5 pt-5 text-left text-[#1e2a3b] shadow-[0_12px_48px_rgba(30,34,44,0.12)] ring-1 ring-black/[0.04] sm:px-6 sm:pt-6"
		>
			{children}
		</div>
	);
}

function Thumb({ icon: Glyph, tint, size = 'size-11' }: { icon: Icon; tint: string; size?: string }) {
	return (
		<span className={cn('grid shrink-0 place-items-center rounded-xl', tint, size)}>
			<Glyph weight="duotone" className="size-1/2" />
		</span>
	);
}

function WindowTitle({ icon: Glyph, children }: { icon: Icon; children: ReactNode }) {
	return (
		<p className="flex items-center gap-2 text-[15px] font-semibold">
			<Glyph weight="fill" className="size-4 text-public-blue" />
			{children}
		</p>
	);
}

/** One beat per shopper: their products swap in as they browse something else. */
const PICKS_BEATS = [3400, 3400] as const;
const SHOPPERS = [
	{
		interest: 'running',
		products: [
			{ name: 'Trail runners', price: '$128', icon: SneakerIcon, tint: 'bg-[#e8f0ff] text-[#145fe4]' },
			{ name: 'Running socks', price: '$16', icon: SockIcon, tint: 'bg-[#fff1e6] text-[#d9692b]' },
			{ name: 'Water flask', price: '$24', icon: DropIcon, tint: 'bg-[#e7f7f1] text-[#14865f]' },
		],
	},
	{
		interest: 'yoga',
		products: [
			{ name: 'Yoga mat', price: '$68', icon: FlowerLotusIcon, tint: 'bg-[#f3ecff] text-[#7a4bd6]' },
			{ name: 'Yoga blocks', price: '$24', icon: PersonSimpleTaiChiIcon, tint: 'bg-[#e8f0ff] text-[#145fe4]' },
			{ name: 'Linen towel', price: '$32', icon: WavesIcon, tint: 'bg-[#e7f7f1] text-[#14865f]' },
		],
	},
] as const;

function PicksMock() {
	const [ref, beat] = useStory<HTMLDivElement>(PICKS_BEATS);
	const shopper = SHOPPERS[beat];
	return (
		<ShopWindow storyRef={ref}>
			<div className="flex items-center justify-between gap-3">
				<WindowTitle icon={SparkleIcon}>Picked for you</WindowTitle>
				<span key={shopper.interest} className="animate-public-rise rounded-full bg-[#eef3ff] px-3 py-1 text-xs text-public-blue">
					Browsing: {shopper.interest}
				</span>
			</div>
			<div className="mt-5 grid grid-cols-3 gap-3">
				{shopper.products.map((product, index) => (
					<div key={product.name} className="animate-public-rise" style={{ animationDelay: `${index * 120}ms` }}>
						<Thumb icon={product.icon} tint={product.tint} size="aspect-square w-full" />
						<p className="mt-2 truncate text-[13px] font-medium">{product.name}</p>
						<p className="text-[13px] text-[#5b6576]">{product.price}</p>
					</div>
				))}
			</div>
			<div className="mt-5 h-2 rounded-full bg-[#f1f3f7]" />
			<div className="mt-2 h-2 w-2/3 rounded-full bg-[#f1f3f7]" />
		</ShopWindow>
	);
}

function CartLine({ icon, tint, name, price, className }: { icon: Icon; tint: string; name: string; price: string; className?: string }) {
	return (
		<div className={cn('flex items-center gap-3', className)}>
			<Thumb icon={icon} tint={tint} />
			<p className="min-w-0 flex-1 truncate text-sm font-medium">{name}</p>
			<p className="text-sm">{price}</p>
		</div>
	);
}

/** The cart alone, the suggestion, the tap on Add, then the bundle in the cart. */
const CART_BEATS = [1400, 1700, 600, 3600] as const;

function CartMock() {
	const [ref, beat] = useStory<HTMLDivElement>(CART_BEATS);
	const suggesting = beat === 1 || beat === 2;
	const added = beat === 3;
	return (
		<ShopWindow storyRef={ref}>
			<div className="flex items-center justify-between">
				<WindowTitle icon={ShoppingBagIcon}>Your cart</WindowTitle>
				<span className="text-xs text-[#5b6576]">{added ? '2 items' : '1 item'}</span>
			</div>
			<div className="mt-4 grid gap-3">
				<CartLine icon={CoffeeBeanIcon} tint="bg-[#fff1e6] text-[#b5651d]" name="House blend, 1 kg" price="$38" />
				{added && <CartLine icon={FunnelSimpleIcon} tint="bg-[#e8f0ff] text-[#145fe4]" name="Ceramic dripper" price="$24" className="animate-public-rise" />}
			</div>
			{suggesting && (
				<div className="mt-4 animate-public-rise rounded-xl bg-[#f5f8ff] p-3 ring-1 ring-[#dfe8fb]">
					<p className="text-[11px] font-medium tracking-[0.08em] text-public-blue uppercase">Goes well with</p>
					<div className="mt-2 flex items-center gap-3">
						<Thumb icon={FunnelSimpleIcon} tint="bg-white text-[#145fe4]" />
						<div className="min-w-0 flex-1">
							<p className="truncate text-sm font-medium">Ceramic dripper</p>
							<p className="text-[13px] text-[#5b6576]">$24</p>
						</div>
						<span
							className={cn(
								'rounded-full px-3.5 py-1.5 text-xs font-medium text-white transition-transform duration-150',
								beat === 2 ? 'scale-90 bg-public-blue-hover' : 'bg-public-blue',
							)}
						>
							Add
						</span>
					</div>
				</div>
			)}
			<div className="mt-4 flex items-center justify-between border-t border-[#eef1f5] pt-3 text-sm">
				<span className="text-[#5b6576]">Subtotal</span>
				<span key={added ? 'bundle' : 'single'} className="flex animate-public-rise items-center gap-2">
					{added && <span className="rounded-full bg-[#e7f7f1] px-2 py-0.5 text-[11px] font-medium text-[#14865f]">Bundle saves 10%</span>}
					{added && <s className="text-[#9aa3b2]">$62</s>}
					<span className="font-semibold">{added ? '$55.80' : '$38'}</span>
				</span>
			</div>
		</ShopWindow>
	);
}

/** The order is confirmed, then a one-time offer rises with its timer running out. */
const OFFER_BEATS = [1800, 4400] as const;

function OfferMock() {
	const [ref, beat] = useStory<HTMLDivElement>(OFFER_BEATS);
	const offering = beat === 1;
	return (
		<ShopWindow storyRef={ref}>
			<div className="flex items-center gap-3">
				<svg viewBox="0 0 40 40" className="size-10 shrink-0">
					<circle cx="20" cy="20" r="20" fill="#e7f7f1" />
					{/* Drawn again each time the story starts over. */}
					<path
						key={beat}
						d="M12.5 20.5l5 5 10-11"
						fill="none"
						stroke="#14865f"
						strokeWidth="3"
						strokeLinecap="round"
						strokeLinejoin="round"
						pathLength={1}
						strokeDasharray="1"
						className={offering ? undefined : 'animate-public-draw'}
					/>
				</svg>
				<div>
					<p className="text-[15px] font-semibold">Order confirmed</p>
					<p className="text-[13px] text-[#5b6576]">Thanks, Maya. Order #1042 is on its way.</p>
				</div>
			</div>
			{offering ? (
				<div className="mt-5 animate-public-rise rounded-xl bg-[#fff8ee] p-4 ring-1 ring-[#f3e3c8]">
					<div className="flex items-center justify-between">
						<p className="text-[11px] font-medium tracking-[0.08em] text-[#b5651d] uppercase">Just for this order</p>
						<span className="flex items-center gap-1.5 text-xs text-[#5b6576]">
							<svg viewBox="0 0 20 20" className="size-4 -rotate-90">
								<circle cx="10" cy="10" r="7" fill="none" stroke="#f3e3c8" strokeWidth="3" />
								<circle cx="10" cy="10" r="7" fill="none" stroke="#14865f" strokeWidth="3" pathLength={1} strokeDasharray="1" className="animate-public-drain" />
							</svg>
							5 min
						</span>
					</div>
					<div className="mt-3 flex items-center gap-3">
						<Thumb icon={JarIcon} tint="bg-white text-[#b5651d]" />
						<div className="min-w-0 flex-1">
							<p className="truncate text-sm font-medium">Add Ethiopia Guji, 250 g</p>
							<p className="text-[13px]">
								<span className="font-semibold">$12</span> <s className="text-[#9aa3b2]">$16</s>
							</p>
						</div>
					</div>
					<span className="mt-3 block rounded-full bg-public-charcoal py-2 text-center text-xs font-medium text-white">Add to my order</span>
				</div>
			) : (
				<div className="mt-5 grid gap-2.5 text-sm">
					{[
						['House blend, 1 kg', '$38'],
						['Shipping', 'Free'],
					].map(([label, value]) => (
						<div key={label} className="flex justify-between">
							<span className="text-[#5b6576]">{label}</span>
							<span>{value}</span>
						</div>
					))}
				</div>
			)}
		</ShopWindow>
	);
}

/** An empty box, the shopper typing in their own words, then what the store found. */
const SEARCH_BEATS = [900, 2400, 3800] as const;
const QUERY = 'a gift for my dad who loves hiking';
const TYPE_MS = 55;
const RESULTS = [
	{ name: 'Trail daypack, 20 L', price: '$89', icon: BackpackIcon, tint: 'bg-[#e7f7f1] text-[#14865f]', fits: ['Hiking', 'Gift idea'] },
	{ name: 'Pocket compass', price: '$29', icon: CompassIcon, tint: 'bg-[#fff1e6] text-[#d9692b]', fits: ['Gift idea'] },
	{ name: 'Two-person tent', price: '$189', icon: TentIcon, tint: 'bg-[#e8f0ff] text-[#145fe4]', fits: ['Hiking'] },
] as const;

function SearchMock() {
	const [ref, beat] = useStory<HTMLDivElement>(SEARCH_BEATS);
	const [typed, setTyped] = useState(0);

	useEffect(() => {
		if (beat !== 1) return;
		let count = 0;
		const timer = setInterval(() => {
			count = Math.min(QUERY.length, count + 1);
			setTyped(count);
		}, TYPE_MS);
		return () => {
			clearInterval(timer);
			setTyped(0);
		};
	}, [beat]);

	const query = beat === 0 ? '' : beat === 1 ? QUERY.slice(0, typed) : QUERY;
	return (
		<ShopWindow storyRef={ref}>
			<div className="flex items-center gap-2 rounded-xl px-3 py-2.5 ring-1 ring-[#dfe3ea]">
				<MagnifyingGlassIcon className="size-4 shrink-0 text-[#5b6576]" />
				<p className="min-w-0 flex-1 truncate text-sm">
					{query || <span className="text-[#9aa3b2]">Search the store</span>}
					{beat < 2 && <span className="ml-px inline-block h-4 w-px translate-y-[3px] animate-public-blink bg-public-blue" />}
				</p>
			</div>
			{beat === 2 && (
				<div className="mt-4 grid gap-3">
					{RESULTS.map((result, index) => (
						<div key={result.name} className="flex animate-public-rise items-center gap-3" style={{ animationDelay: `${index * 140}ms` }}>
							<Thumb icon={result.icon} tint={result.tint} />
							<div className="min-w-0 flex-1">
								<p className="truncate text-sm font-medium">{result.name}</p>
								<p className="mt-1 flex gap-1.5">
									{result.fits.map((fit) => (
										<span key={fit} className="rounded-full bg-[#f1f3f7] px-2 py-0.5 text-[11px] text-[#5b6576]">
											{fit}
										</span>
									))}
								</p>
							</div>
							<p className="text-sm">{result.price}</p>
						</div>
					))}
				</div>
			)}
		</ShopWindow>
	);
}

const MOCKS: Readonly<Record<ShopperCardId, () => ReactNode>> = {
	picks: PicksMock,
	cart: CartMock,
	offer: OfferMock,
	search: SearchMock,
};

/** A shopper's moment in the store; the card's text carries the meaning, so the picture stays decorative. */
export function ShopperMock({ id }: { id: ShopperCardId }) {
	const Mock = MOCKS[id];
	return <Mock />;
}
