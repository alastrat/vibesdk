import { t, tn, msg, getLocale, useI18n } from '@/lib/i18n';
import { useCallback, type ReactNode } from 'react';
import { CurrencyDollarIcon, DownloadSimpleIcon, LinkSimpleIcon, SparkleIcon } from '@phosphor-icons/react';
import { NumberTicker } from '@/components/magicui/number-ticker';
import type { SellerId } from '@/content/positioning';
import { useStory } from '@/hooks/use-story';
import { EXAMPLE_SALE_CENTS, formatCents, sellerKeepsCents } from '@/lib/pricing';
import { cn } from '@/lib/utils';
import { HERO_STORE_IMAGE } from '@/routes/landing/Hero';
import { ArtCanvas, GreenRing, Photo, StoryFrame } from './art-kit';
import { MUTED, PANEL, PHOTOS } from './art-styles';

/** Each picture is drawn at this size and zoomed to its card's width, so it scales like an image. */
const ART_WIDTH = 560;
const ART_HEIGHT = 360;

const CATALOG = [
	{ name: msg("Wool socks"), photo: PHOTOS.socks, costCents: 620, priceCents: 1800, margin: '66%' },
	{ name: msg("Insulated bottle"), photo: PHOTOS.bottle, costCents: 980, priceCents: 2600, margin: '62%' },
	{ name: msg("Brass compass"), photo: PHOTOS.compass, costCents: 1150, priceCents: 3800, margin: '70%' },
] as const;
const CATALOG_COLUMNS = 'grid grid-cols-[1fr_60px_72px_56px_92px] items-center gap-x-3';
/** The product being added: its Add is tapped, it joins the store, and Estori writes its page. */
const ADDING = 1;
const CATALOG_BEATS = [1500, 500, 3800] as const;

function CatalogArt() {
	const [ref, beat] = useStory<HTMLDivElement>(CATALOG_BEATS);
	const added = beat === 2;
	return (
		<StoryFrame storyRef={ref} className="relative">
			<div className={cn(PANEL, 'px-6 pt-6 pb-4')}>
				<div className="flex items-center justify-between">
					<p className="text-[22px] font-bold tracking-[-0.02em]">{t("Curated catalog")}</p>
					<span className="rounded-full bg-[#f3f4f6] px-3 py-1 text-[13px] text-[#4b5563]">{tn('Outdoor · {count} product', 'Outdoor · {count} products', 1240)}</span>
				</div>
				<div className={cn(CATALOG_COLUMNS, 'mt-4 border-b border-[#eceef1] pb-2 text-[11px] tracking-[0.06em] text-[#9aa3b2] uppercase')}>
					<span>{t("Product")}</span>
					<span>{t("Cost")}</span>
					<span>{t("You sell")}</span>
					<span>{t("Margin")}</span>
					<span />
				</div>
				{CATALOG.map((product, index) => (
					<div key={product.name} className={cn(CATALOG_COLUMNS, 'border-b border-[#eceef1] py-3 last:border-0')}>
						<span className="flex min-w-0 items-center gap-3">
							<Photo src={product.photo} className="size-12 rounded-[12px]" />
							<span className="min-w-0">
								<span className="block truncate text-[15px] font-semibold">{t(product.name)}</span>
								<span className={cn('block text-[12px]', MUTED)}>{t("Ships in 3–5 days")}</span>
							</span>
						</span>
						<span className="text-[14px] text-[#4b5563]">{formatCents(product.costCents, getLocale())}</span>
						<span className="text-[14px] font-semibold">{formatCents(product.priceCents, getLocale())}</span>
						<span className="w-fit rounded-full bg-[#e7f7ee] px-2 py-0.5 text-[12px] font-semibold text-[#14865f]">{product.margin}</span>
						<span className="justify-self-end">
							{index === ADDING && added ? (
								<span className="flex items-center gap-1.5 text-[14px] text-[#4b5563]">{t("Added")}<GreenRing />
								</span>
							) : (
								<span
									className={cn(
										'inline-block rounded-full px-3.5 py-1 text-[13px] font-medium transition-transform duration-150',
										index === ADDING ? 'text-white' : 'bg-[#f3f4f6] ring-1 ring-black/10',
										index === ADDING && (beat === 1 ? 'scale-90 bg-public-blue-hover' : 'bg-public-blue'),
									)}
								>{t("Add")}</span>
							)}
						</span>
					</div>
				))}
			</div>
			{added && (
				<p className="absolute bottom-3 left-1/2 flex -translate-x-1/2 animate-public-rise items-center gap-2 rounded-full bg-public-charcoal px-4 py-2 text-[13px] whitespace-nowrap text-white shadow-lg">
					<SparkleIcon weight="fill" className="size-4 text-[#9cc2ff]" />{t("Product page written for Insulated bottle")}</p>
			)}
		</StoryFrame>
	);
}

const POSTS = [
	{ who: 'Leo', tint: 'bg-[#dbe8fb] text-[#145fe4]', when: msg("Just now"), text: msg("Got the guide this morning. Chapter 2 is so good.") },
	{ who: 'Ana', tint: 'bg-[#fde2d4] text-[#b4532a]', when: msg("2h"), text: msg("Day 3 of the morning routine. Coffee before email!") },
	{ who: 'Sam', tint: 'bg-[#e7f7ee] text-[#14865f]', when: msg("5h"), text: msg("Shared my favorite tea pairing in the recipes thread.") },
] as const;
const MEMBERS = ['bg-[#fde2d4]', 'bg-[#dbe8fb]', 'bg-[#e7f7ee]', 'bg-[#f3ecff]'] as const;
/** A copy is delivered, and its buyer says hello in the community. */
const DIGITAL_BEATS = [1800, 4200] as const;

function Post({ post, className }: { post: (typeof POSTS)[number]; className?: string }) {
	return (
		<div className={cn('flex gap-3', className)}>
			<span className={cn('grid size-8 shrink-0 place-items-center rounded-full text-[13px] font-semibold', post.tint)}>{post.who[0]}</span>
			<div className="min-w-0">
				<p className="text-[13px]">
					<span className="font-semibold">{post.who}</span> <span className={MUTED}>{t(post.when)}</span>
				</p>
				<p className="mt-0.5 text-[14px] leading-snug">{t(post.text)}</p>
			</div>
		</div>
	);
}

function DigitalArt() {
	const [ref, beat] = useStory<HTMLDivElement>(DIGITAL_BEATS);
	const delivered = beat === 1;
	const [newest, ...earlier] = POSTS;
	return (
		<StoryFrame storyRef={ref} className="flex items-start gap-5">
			<div className="w-[196px] shrink-0">
				<div className="relative h-[236px] overflow-hidden rounded-l-[6px] rounded-r-[14px] bg-[linear-gradient(160deg,#f6c9ae_0%,#e38a63_55%,#b8573a_100%)] p-6 text-white shadow-[0_18px_40px_rgba(120,60,30,0.28)]">
					<span className="absolute inset-y-0 left-3 w-px bg-white/30" />
					<p className="text-[11px] tracking-[0.18em] uppercase opacity-80">{t("A field guide")}</p>
					<p className="mt-3 font-serif text-[30px] leading-[1.05]">Slow Mornings</p>
					<p className="mt-2 text-[13px] opacity-85">{t("Calm routines for busy weeks")}</p>
					<p className="absolute bottom-6 left-6 text-[13px] font-semibold">Maya Lin</p>
				</div>
				<div className={cn(PANEL, 'mt-4 px-4 py-3')}>
					<p className="flex items-center justify-between text-[13px] font-semibold">
						<span className="flex items-center gap-1.5">
							<DownloadSimpleIcon className="size-4" />{t("Instant download")}</span>
						<span className={cn('font-normal', MUTED)}>PDF</span>
					</p>
					<div className="mt-2 h-1.5 rounded-full bg-[#eceef1]">
						<div className="h-full rounded-full bg-[#7a4bd6] transition-[width] duration-[1600ms] ease-out" style={{ width: delivered ? '100%' : '6%' }} />
					</div>
				</div>
			</div>
			<div className={cn(PANEL, 'min-w-0 flex-1 px-5 pt-5 pb-6')}>
				<p className="text-[18px] font-bold tracking-[-0.01em]">{t("Members' community")}</p>
				<div className="mt-2 flex items-center gap-2">
					<span className="flex -space-x-2">
						{MEMBERS.map((tint) => (
							<span key={tint} className={cn('size-6 rounded-full ring-2 ring-white', tint)} />
						))}
					</span>
					<span className={cn('text-[13px]', MUTED)}>{tn('{count} member', '{count} members', delivered ? 1285 : 1284)}</span>
				</div>
				<div className="mt-5 grid gap-4">
					{delivered && <Post post={newest} className="animate-public-rise" />}
					{earlier.map((post) => (
						<Post key={post.who} post={post} />
					))}
				</div>
			</div>
		</StoryFrame>
	);
}

const TEMPLATE_SALES = 128;
const KEEPS_CENTS = sellerKeepsCents(EXAMPLE_SALE_CENTS);
/** A template sells again: the sale arrives and the totals count up. */
const TEMPLATE_BEATS = [1600, 4200] as const;

function Stat({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="rounded-[12px] bg-[#f7f8fa] px-4 py-3">
			<p className={cn('text-[12px]', MUTED)}>{t(label)}</p>
			<p className="mt-1 text-[22px] font-bold tracking-[-0.02em]">{children}</p>
		</div>
	);
}

function TemplateArt() {
	const { locale } = useI18n();
	const money = useCallback((value: number) => formatCents(Math.round(value * 100), locale), [locale]);
	const [ref, beat] = useStory<HTMLDivElement>(TEMPLATE_BEATS);
	const sold = beat === 1;
	const sales = sold ? TEMPLATE_SALES + 1 : TEMPLATE_SALES;
	return (
		<StoryFrame storyRef={ref} className="relative">
			<div className={cn(PANEL, 'p-5')}>
				<div className="flex gap-5">
					<Photo src={HERO_STORE_IMAGE} className="h-[150px] w-[232px] rounded-[12px] object-left-top ring-1 ring-black/5" />
					<div className="min-w-0 flex-1 pt-1">
						<p className="text-[12px] tracking-[0.08em] text-public-blue uppercase">{t("Template in Discover")}</p>
						<p className="mt-1 text-[24px] leading-tight font-bold tracking-[-0.02em]">North Ridge Coffee</p>
						<p className={cn('mt-1 text-[14px]', MUTED)}>{t("By you · Coffee store")}</p>
						<span className="mt-4 inline-block rounded-full bg-public-charcoal px-3 py-1 text-[14px] font-semibold text-white">{formatCents(EXAMPLE_SALE_CENTS, getLocale())}</span>
					</div>
				</div>
				<div className="mt-5 grid grid-cols-3 gap-3">
					<Stat label={t("Sales")}>
						<NumberTicker key={sold ? 'sold' : 'waiting'} startValue={TEMPLATE_SALES} value={sales} />
					</Stat>
					<Stat label={t("You keep per sale")}>{formatCents(KEEPS_CENTS, getLocale())}</Stat>
					<Stat label={t("Earned")}>
						<NumberTicker formatter={money} key={sold ? 'sold' : 'waiting'} startValue={(TEMPLATE_SALES * KEEPS_CENTS) / 100} value={(sales * KEEPS_CENTS) / 100} decimalPlaces={2} />
					</Stat>
				</div>
			</div>
			{sold && (
				<div className="absolute -top-1 right-3 flex w-[252px] animate-public-rise items-center gap-3 rounded-[14px] bg-white p-3 shadow-[0_12px_32px_rgba(17,24,39,0.18)] ring-1 ring-black/5">
					<span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-[#e7f7ee] text-[#14865f]">
						<CurrencyDollarIcon weight="bold" className="size-5" />
					</span>
					<span className="min-w-0">
						<span className="block text-[13px] font-semibold">{t("New sale")}</span>
						<span className={cn('block truncate text-[12px]', MUTED)}>{t('{store} · +{amount}', { store: 'North Ridge Coffee', amount: formatCents(KEEPS_CENTS, getLocale()) })}</span>
					</span>
				</div>
			)}
		</StoryFrame>
	);
}

const LINK_STATS = [
	{ label: msg("Clicks"), from: 2210, to: 2340, decimals: 0, prefix: '' },
	{ label: msg("Sales"), from: 79, to: 86, decimals: 0, prefix: '' },
	{ label: msg("Earned"), from: 371.2, to: 412.8, decimals: 2, prefix: '$' },
] as const;
const WEEK = [
	{ day: 'Mon', height: 38 },
	{ day: 'Tue', height: 52 },
	{ day: 'Wed', height: 44 },
	{ day: 'Thu', height: 66 },
	{ day: 'Fri', height: 58 },
	{ day: 'Sat', height: 84 },
	{ day: 'Sun', height: 72 },
] as const;
const SHARED = [
	{ name: msg("Wool socks"), photo: PHOTOS.socks, sales: 41 },
	{ name: msg("Trail daypack"), photo: PHOTOS.daypack, sales: 27 },
	{ name: msg("Brass compass"), photo: PHOTOS.compass, sales: 18 },
] as const;
/** The link is copied and shared, and the week's clicks, sales and earnings climb. */
const LINK_BEATS = [1000, 4800] as const;

function AffiliateArt() {
	const { locale } = useI18n();
	const money = useCallback((value: number) => formatCents(Math.round(value * 100), locale), [locale]);
	const [ref, beat] = useStory<HTMLDivElement>(LINK_BEATS);
	const live = beat === 1;
	return (
		<StoryFrame storyRef={ref}>
			<div className={cn(PANEL, 'px-6 pt-6 pb-6')}>
				<div className="flex items-center justify-between">
					<p className="text-[22px] font-bold tracking-[-0.02em]">{t("Your link")}</p>
					<span className="rounded-full bg-[#e7f7ee] px-3 py-1 text-[13px] font-medium text-[#14865f]">{t("Paid on every sale")}</span>
				</div>
				<div className="mt-4 flex items-center gap-3 rounded-[12px] px-4 py-3 ring-1 ring-[#d9dce3]">
					<LinkSimpleIcon className="size-5 shrink-0 text-public-blue" />
					<span className="min-w-0 flex-1 truncate text-[16px]">northridge.estori.app/?ref=maya</span>
					<span className={cn('rounded-lg px-3 py-1 text-[14px] transition-colors duration-300', live ? 'bg-[#e7f7ee] text-[#14865f]' : 'bg-[#f3f4f6] ring-1 ring-black/10')}>
						{t(live ? 'Copied' : 'Copy')}
					</span>
				</div>
				<div className="mt-5 grid grid-cols-[1fr_1fr_1.2fr_1.3fr] items-end gap-3">
					{LINK_STATS.map((stat) => (
						<Stat key={stat.label} label={t(stat.label)}>
							<NumberTicker formatter={stat.prefix ? money : undefined} key={live ? 'live' : 'waiting'} startValue={stat.from} value={live ? stat.to : stat.from} decimalPlaces={stat.decimals} />
						</Stat>
					))}
					<div className="flex h-[68px] items-end gap-1.5">
						{WEEK.map((day, index) => (
							<span
								key={day.day}
								className="flex-1 rounded-t-[4px] bg-[#7fd4a6] transition-[height] duration-700 ease-out"
								style={{ height: `${live ? day.height : day.height * 0.4}%`, transitionDelay: `${index * 70}ms` }}
							/>
						))}
					</div>
				</div>
				<div className="mt-5 grid grid-cols-3 gap-3">
					{SHARED.map((product) => (
						<div key={product.name} className="flex items-center gap-3">
							<Photo src={product.photo} className="size-10 rounded-[10px]" />
							<span className="min-w-0">
								<span className="block truncate text-[13px] font-semibold">{t(product.name)}</span>
								<span className={cn('block text-[12px]', MUTED)}>{tn('{count} sale', '{count} sales', product.sales)}</span>
							</span>
						</div>
					))}
				</div>
			</div>
		</StoryFrame>
	);
}

const TINTS: Readonly<Record<SellerId, string>> = {
	resellers: 'bg-[linear-gradient(180deg,#fdf8ef_0%,#f5e8d0_100%)]',
	digital: 'bg-[linear-gradient(180deg,#f8f4fe_0%,#e8ddfb_100%)]',
	developers: 'bg-[linear-gradient(180deg,#f3f7ff_0%,#dce7fd_100%)]',
	creators: 'bg-[linear-gradient(180deg,#f1faf5_0%,#d8f0e2_100%)]',
};

const ARTS: Readonly<Record<SellerId, () => ReactNode>> = {
	resellers: CatalogArt,
	digital: DigitalArt,
	developers: TemplateArt,
	creators: AffiliateArt,
};

/** A seller's picture on its own tint, cut off by the card's bottom edge. */
export function SellerArt({ id }: { id: SellerId }) {
	const Art = ARTS[id];
	return (
		<ArtCanvas width={ART_WIDTH} height={ART_HEIGHT} className={cn('rounded-[25px] px-6 pt-8 sm:px-10 sm:pt-10', TINTS[id])}>
			<Art />
		</ArtCanvas>
	);
}
