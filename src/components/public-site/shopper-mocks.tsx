import { useEffect, useId, useState, type ReactNode } from 'react';
import { ArrowClockwiseIcon, CaretLeftIcon, CaretUpDownIcon, SparkleIcon } from '@phosphor-icons/react';
import { NumberTicker } from '@/components/magicui/number-ticker';
import type { ShopperCardId } from '@/content/positioning';
import { useStory } from '@/hooks/use-story';
import { cn } from '@/lib/utils';
import { ArtCanvas, Field, GreenRing, Photo, StoryFrame } from './art-kit';
import { FIELDS, MUTED, PANEL, PHOTOS } from './art-styles';

/** Each picture is drawn at this size and zoomed to its card's width, so it scales like an image. */
const ART_WIDTH = 512;
const ART_HEIGHT = 432;

/** The gauge: a 270 degree arc from bottom left to bottom right, green into blue, with ticks and a marker. */
const GAUGE_ARC = 'M43.43 160.57 A80 80 0 1 1 156.57 160.57';
const GAUGE_TICKS = Array.from({ length: 28 }, (_, index) => ((135 + (270 / 27) * index) * Math.PI) / 180);

function Gauge({ filled }: { filled: boolean }) {
	const fade = useId();
	return (
		<div className="relative size-[196px] shrink-0">
			<svg viewBox="0 0 200 200" className="size-full">
				<defs>
					<linearGradient id={fade} x1="0" y1="0" x2="1" y2="0">
						<stop offset="0" stopColor="#1caf1b" />
						<stop offset="0.5" stopColor="#2cbf3c" />
						<stop offset="0.78" stopColor="#3cc79a" />
						<stop offset="1" stopColor="#5bb9f6" />
					</linearGradient>
				</defs>
				<path
					d={GAUGE_ARC}
					fill="none"
					stroke={`url(#${fade})`}
					strokeWidth="22"
					strokeLinecap="round"
					pathLength={1}
					strokeDasharray="1"
					className={filled ? 'animate-public-draw' : undefined}
					style={filled ? { animationDuration: '1600ms' } : { strokeDashoffset: 1 }}
				/>
				<g stroke="rgba(0,64,16,0.28)" strokeWidth="1.6" strokeLinecap="round" className={cn('transition-opacity duration-700', filled ? 'opacity-100' : 'opacity-0')}>
					{GAUGE_TICKS.map((angle) => (
						<line key={angle} x1={100 + 71 * Math.cos(angle)} y1={104 + 71 * Math.sin(angle)} x2={100 + 78 * Math.cos(angle)} y2={104 + 78 * Math.sin(angle)} />
					))}
				</g>
				<path d="M100 44 L91 58 L109 58 Z" fill="#1caf1b" />
			</svg>
			<div className="absolute inset-0 flex flex-col items-center justify-center pt-5">
				<NumberTicker key={filled ? 'scored' : 'waiting'} value={filled ? 859 : 0} className="text-[52px] leading-none font-bold tracking-[-0.03em]" />
				<span className="mt-1.5 text-[14px] font-semibold tracking-[0.04em] text-[#4b5563] uppercase">Very good</span>
			</div>
		</div>
	);
}

const PICKS = [
	{ score: 96, name: 'Wool socks', why: 'Top pick for shoppers who browse hiking gear.', photo: PHOTOS.socks },
	{ score: 91, name: 'Insulated bottle', why: 'Often bought with the wool socks.', photo: PHOTOS.bottle },
] as const;

/** The score empties, then machine learning scores the store again: the arc draws in and the numbers count up. */
const SCORE_BEATS = [900, 6400] as const;

function ScoreArt() {
	const [ref, beat] = useStory<HTMLDivElement>(SCORE_BEATS);
	const scored = beat === 1;
	return (
		<StoryFrame storyRef={ref}>
			<div className={cn(PANEL, 'flex items-center justify-between gap-3 py-5 pr-5 pl-7')}>
				<div className="min-w-0">
					<p className="flex items-center gap-2.5 text-[26px] leading-none font-bold tracking-[-0.02em]">
						<span className="grid size-9 place-items-center rounded-[10px] bg-[linear-gradient(135deg,#6aa0ff,#145fe4)] text-white">
							<SparkleIcon weight="fill" className="size-5" />
						</span>
						Shopper match
					</p>
					<p className={cn('mt-3.5 text-[13.5px] leading-snug', MUTED)}>Machine learning scores how well each product fits each shopper.</p>
					<span className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#f6f6f7] px-3 py-1.5 text-[14px] ring-1 ring-black/10">
						<SparkleIcon className="size-4" />
						See top picks
					</span>
				</div>
				<Gauge filled={scored} />
			</div>
			<div className="mt-4 grid grid-cols-2 gap-4">
				{PICKS.map((pick) => (
					<div key={pick.name} className={cn(PANEL, 'p-6')}>
						<div className="flex items-start justify-between gap-3">
							<p className="text-[46px] leading-none font-bold tracking-[-0.03em]">
								<NumberTicker key={scored ? 'scored' : 'waiting'} value={scored ? pick.score : 0} />%
							</p>
							<Photo src={pick.photo} className="size-[68px] rounded-[16px]" />
						</div>
						<p className="mt-5 text-[17px] font-bold">{pick.name}</p>
						<p className={cn('mt-1.5 text-[13.5px] leading-snug', MUTED)}>{pick.why}</p>
					</div>
				))}
			</div>
		</StoryFrame>
	);
}

/** The suggestion with its Add button, the tap, then the bundle applied. */
const CART_BEATS = [1600, 600, 4400] as const;

function CartArt() {
	const [ref, beat] = useStory<HTMLDivElement>(CART_BEATS);
	const added = beat === 2;
	return (
		<StoryFrame storyRef={ref}>
			<div className={cn(PANEL, 'mx-auto w-[456px] px-8 pt-8 pb-7')}>
				<div className="flex items-center gap-5">
					<Photo src={PHOTOS.houseBlend} className="size-[84px] rounded-[20px]" />
					<div>
						<p className="text-[30px] leading-tight font-bold tracking-[-0.02em]">House blend</p>
						<p className={cn('mt-0.5 text-[15px]', MUTED)}>In your cart · 1 kg · $38</p>
					</div>
				</div>
				<div className={cn(FIELDS, 'mt-7')}>
					<Field label="goes well with">
						<div className="flex items-center gap-3">
							<Photo src={PHOTOS.dripper} className="size-9 rounded-lg" />
							<span className="min-w-0 flex-1 truncate">Ceramic dripper · $24</span>
							{added ? (
								<span className="flex items-center gap-2 text-[16px] text-[#4b5563]">
									Added
									<GreenRing />
								</span>
							) : (
								<span
									className={cn(
										'rounded-full px-4 py-1 text-[15px] font-medium text-white transition-transform duration-150',
										beat === 1 ? 'scale-90 bg-public-blue-hover' : 'bg-public-blue',
									)}
								>
									Add
								</span>
							)}
						</div>
					</Field>
					<Field label="bundle">
						<div className="flex items-center justify-between gap-3">
							<span className={added ? undefined : MUTED}>{added ? 'Save 10% on both' : 'Add the dripper to save 10%'}</span>
							{added && (
								<span className="flex items-center gap-2 text-[16px] text-[#4b5563]">
									Applied
									<GreenRing />
								</span>
							)}
						</div>
					</Field>
					<Field label="subtotal">
						<span key={added ? 'bundle' : 'single'} className="inline-flex animate-public-rise items-baseline gap-2">
							{added && <s className="text-[15px] text-[#9aa3b2]">$62.00</s>}
							<span className="font-semibold">{added ? '$55.80' : '$38.00'}</span>
						</span>
					</Field>
					<Field label="ships">Free, in 2 days</Field>
				</div>
			</div>
		</StoryFrame>
	);
}

/** Ten seconds of the offer's countdown, then it starts over. */
const OFFER_BEATS = Array.from({ length: 10 }, () => 1000);

function OfferArt() {
	const [ref, beat] = useStory<HTMLDivElement>(OFFER_BEATS);
	return (
		<StoryFrame storyRef={ref}>
			<div className={cn(PANEL, 'mx-auto w-[440px] px-8 pt-9 pb-8')}>
				<p className="text-center text-[28px] leading-[1.15] font-bold tracking-[-0.02em] text-balance">Thanks for your order, Maya</p>
				<div className="mt-7 overflow-hidden rounded-[16px] ring-1 ring-[#e2e4e9]">
					<p className="bg-[#dbe8fb] py-4 text-center text-[17px]">This offer is only for this order</p>
					<div className="px-6 pt-6 pb-5">
						<div className="flex items-center gap-5">
							<Photo src={PHOTOS.guji} className="size-[76px] rounded-[18px]" />
							<p className="text-[26px] leading-tight font-bold tracking-[-0.02em]">Ethiopia Guji</p>
						</div>
						<div className={cn(FIELDS, 'mt-6')}>
							<Field label="price, 250 g">
								<span className="font-semibold">$12.00</span> <s className="text-[15px] text-[#9aa3b2]">$16.00</s>
							</Field>
							<Field label="offer ends in">
								<span className="flex items-center gap-2.5">
									<span className="tabular-nums">4:{59 - beat}</span>
									<span className="inline-flex items-center rounded-full bg-[#f1f3f6] p-1">
										<svg viewBox="0 0 20 20" className="size-4 -rotate-90">
											<circle cx="10" cy="10" r="7" fill="none" stroke="#dfe3e8" strokeWidth="3" />
											<circle
												cx="10"
												cy="10"
												r="7"
												fill="none"
												stroke="#17a317"
												strokeWidth="3"
												pathLength={1}
												strokeDasharray="1"
												strokeDashoffset={beat / OFFER_BEATS.length}
												className={beat === 0 ? undefined : 'transition-[stroke-dashoffset] duration-1000 ease-linear'}
											/>
										</svg>
									</span>
								</span>
							</Field>
						</div>
					</div>
				</div>
			</div>
		</StoryFrame>
	);
}

/** An empty box, the shopper typing in their own words, then what the store understood and found. */
const SEARCH_BEATS = [800, 2600, 4600] as const;
const QUERY = 'a gift for my dad who loves hiking';
const TYPE_MS = 55;
/** Words the search understood, colored like the digits and symbols in 1Password's generator. */
const KEYWORDS: Readonly<Record<string, string>> = { gift: 'text-public-blue', dad: 'text-[#e0245e]', hiking: 'text-[#16a34a]' };
const MATCHES = [PHOTOS.daypack, PHOTOS.compass, PHOTOS.bottle] as const;

function Toggle({ on }: { on: boolean }) {
	return (
		<span className={cn('flex h-7 w-12 items-center rounded-full p-0.5 transition-colors duration-300', on ? 'bg-public-blue' : 'bg-[#e3e5e9]')}>
			<span className={cn('size-6 rounded-full bg-white shadow transition-transform duration-300', on && 'translate-x-5')} />
		</span>
	);
}

function SearchRow({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="flex items-center justify-between py-3.5">
			<span className={cn('text-[16px]', MUTED)}>{label}</span>
			{children}
		</div>
	);
}

function SearchArt() {
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

	const understood = beat === 2;
	const query = beat === 0 ? '' : understood ? QUERY : QUERY.slice(0, typed);
	const progress = understood ? 1 : query.length / QUERY.length;
	return (
		<StoryFrame storyRef={ref}>
			<div className={cn(PANEL, 'mx-auto w-[456px] overflow-hidden')}>
				<div className="relative flex h-16 items-center justify-center border-b border-[#e7e8ec]">
					<CaretLeftIcon className="absolute left-6 size-5 text-[#6b7280]" />
					<p className="text-[20px] font-semibold">Smart search</p>
				</div>
				<div className="px-7 pt-5 pb-12">
					<div className="flex items-center justify-between">
						<span className="rounded-lg bg-[#f3f4f6] px-4 py-1.5 text-[16px] ring-1 ring-black/10">Clear</span>
						<ArrowClockwiseIcon className="size-5 text-[#4b5563]" />
						<span className="rounded-lg bg-public-blue px-4 py-1.5 text-[16px] text-white">Search</span>
					</div>
					<p className="mt-4 h-[52px] truncate rounded-[10px] px-4 py-3 text-[18px] tracking-[0.01em] ring-1 ring-[#d9dce3]">
						{query.split(' ').map((word, index) => (
							<span key={`${word}-${index}`} className={cn(understood && KEYWORDS[word], understood && KEYWORDS[word] && 'font-semibold')}>
								{index > 0 && ' '}
								{word}
							</span>
						))}
						{!understood && <span className="ml-px inline-block h-5 w-px translate-y-1 animate-public-blink bg-public-blue" />}
					</p>
					<div className="mt-3 h-[3px] rounded-full bg-[#e5e7eb]">
						<div className="h-full rounded-full bg-[#22b021] transition-[width] duration-300" style={{ width: `${progress * 88}%` }} />
					</div>
					<div className="mt-2 divide-y divide-[#eceef1]">
						<SearchRow label="Looking for">
							<span className="flex items-center gap-5 rounded-lg px-3 py-1.5 text-[16px] ring-1 ring-[#d9dce3]">
								{understood ? 'A gift for dad' : 'Anything'}
								<CaretUpDownIcon className="size-4 text-[#6b7280]" />
							</span>
						</SearchRow>
						<SearchRow label="Into hiking">
							<Toggle on={understood} />
						</SearchRow>
						<SearchRow label="Best matches">
							<span className="flex items-center gap-2">
								{MATCHES.map((photo, index) => (
									<Photo
										key={photo}
										src={photo}
										className={cn('size-10 rounded-lg', understood ? 'animate-public-rise' : 'opacity-0')}
										style={{ animationDelay: `${index * 140}ms` }}
									/>
								))}
							</span>
						</SearchRow>
					</div>
				</div>
			</div>
		</StoryFrame>
	);
}

const ARTS: Readonly<Record<ShopperCardId, () => ReactNode>> = {
	picks: ScoreArt,
	cart: CartArt,
	offer: OfferArt,
	search: SearchArt,
};

/** A card's picture on its white-to-cream fade, cut off by the card's edge as on 1Password. */
export function ShopperArt({ id }: { id: ShopperCardId }) {
	const Art = ARTS[id];
	return (
		<ArtCanvas width={ART_WIDTH} height={ART_HEIGHT} className="mt-8 bg-[linear-gradient(180deg,#ffffff_0%,#fbf6ec_100%)] px-5 sm:mt-10 sm:px-10">
			<Art />
		</ArtCanvas>
	);
}
