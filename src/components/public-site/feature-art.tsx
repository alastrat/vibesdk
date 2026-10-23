import { t, tn, msg, getLocale, T } from '@/lib/i18n';
import { formatUsd } from '@/lib/plans';
import { NumberTicker } from '@/components/magicui/number-ticker';
import type { ReactNode, Ref } from 'react';
import { CheckIcon, DesktopIcon, DeviceMobileIcon, ShoppingBagIcon, SparkleIcon } from '@phosphor-icons/react';
import type { StoreFeatureId } from '@/content/positioning';
import { useStory } from '@/hooks/use-story';
import { useTypedText } from '@/hooks/use-typed-text';
import { cn } from '@/lib/utils';
import { ArtCanvas, Photo, StoryFrame } from './art-kit';
import { DISCOVER_SHOT, MUTED, PHOTOS, PREVIEW_SHOTS } from './art-styles';

/** Each picture is drawn at this size and zoomed to its card's width; the card's bottom edge cuts it off. */
const ART_WIDTH = 400;
const ART_HEIGHT = 250;

/** Vori's small floating panels: white, a hairline border and a whisper of shadow. */
const MINI = 'rounded-[10px] border border-[#ececec] bg-white shadow-[0_6px_20px_rgba(17,24,39,0.06)]';
const MONO = 'font-mono text-[12px] text-[#6b7280]';

function Done({ children, className }: { children: ReactNode; className?: string }) {
	return (
		<p className={cn('flex items-center gap-2 text-[13px] font-semibold', className)}>
			<CheckIcon weight="bold" className="size-4 text-[#16a34a]" />
			{children}
		</p>
	);
}

const CATALOG = [
	{ name: 'Wool socks', photo: PHOTOS.socks },
	{ name: 'Insulated bottle', photo: PHOTOS.bottle },
	{ name: 'Brass compass', photo: PHOTOS.compass },
	{ name: 'Trail daypack', photo: PHOTOS.daypack },
] as const;
/** The products arrive one by one, then the filters are ready. */
const CATALOG_BEATS = [700, 450, 450, 450, 3600] as const;

function CatalogArt() {
	const [ref, beat] = useStory<HTMLDivElement>(CATALOG_BEATS);
	const ready = beat === CATALOG_BEATS.length - 1;
	return (
		<StoryFrame storyRef={ref} className="relative mx-auto w-[300px] pt-[52px]">
			<div className={cn(MINI, 'absolute top-2 -left-6 w-[220px] px-4 pt-2.5 pb-6 opacity-60')}>
				<p className="text-[12px] font-semibold">{t("Describe your products")}</p>
				<p className={cn(MONO, 'mt-1 truncate')}>{t("wool socks, 3 sizes...")}</p>
			</div>
			<div className={cn(MINI, 'relative px-4 pt-4 pb-3')}>
				<p className="flex items-center justify-between text-[13px] font-semibold">{t("Catalog")}<span className={MONO}>{tn('{count} product', '{count} products', 12)}</span>
				</p>
				<div className="mt-3 grid grid-cols-4 gap-2">
					{CATALOG.map((product, index) => (
						<span key={product.name} className="block">
							{index < beat ? (
								<Photo src={product.photo} className="aspect-square w-full animate-public-rise rounded-[8px]" />
							) : (
								<span className="block aspect-square w-full rounded-[8px] bg-[#f3f4f6]" />
							)}
						</span>
					))}
				</div>
				<div className="mt-3 h-6">{ready && <Done className="animate-public-rise">{t("Filters: size, color")}</Done>}</div>
			</div>
		</StoryFrame>
	);
}

/** The shopper fills in their details, taps the button, and the confirmation arrives. */
const CHECKOUT_BEATS = [1500, 500, 3800] as const;

function CheckoutArt() {
	const [ref, beat] = useStory<HTMLDivElement>(CHECKOUT_BEATS);
	const confirmed = beat === 2;
	return (
		<StoryFrame storyRef={ref} className="relative mx-auto w-[230px] pt-4">
			<div className="h-[290px] rounded-[34px] border-[7px] border-[#1d2433] bg-white px-4 pt-7 shadow-[0_10px_30px_rgba(17,24,39,0.12)]">
				<span className="absolute top-[22px] left-1/2 h-[18px] w-[64px] -translate-x-1/2 rounded-full bg-[#1d2433]" />
				<p className="flex items-center gap-1.5 text-[13px] font-semibold">
					<ShoppingBagIcon weight="fill" className="size-4 text-public-blue" />{t("Checkout")}</p>
				<div className="mt-3 flex items-center gap-2.5">
					<Photo src={PHOTOS.houseBlend} className="size-9 rounded-[8px]" />
					<span className="min-w-0 flex-1 truncate text-[12px] font-medium">House blend, 1 kg</span>
					<span className="text-[12px]">{formatUsd(3800, getLocale())}</span>
				</div>
				<div className="mt-3 grid gap-1.5">
					<span className={cn(MONO, 'rounded-md border border-[#ececec] px-2 py-1')}>Maya Lin</span>
					<span className={cn(MONO, 'rounded-md border border-[#ececec] px-2 py-1')}>12 Harbor St</span>
				</div>
				<span
					className={cn(
						'mt-3 block rounded-full py-1.5 text-center text-[12px] font-medium text-white transition-transform duration-150',
						beat === 1 ? 'scale-95 bg-public-blue-hover' : 'bg-public-blue',
					)}
				>{t("Place order")}</span>
			</div>
			{confirmed && (
				<p className="absolute top-[150px] -left-10 w-[200px] animate-public-rise rounded-[12px] bg-public-blue px-3.5 py-2.5 text-[13px] leading-snug text-white shadow-[0_10px_24px_rgba(20,95,228,0.3)]">{t('Order {order} confirmed. A receipt is on its way.', { order: '#1042' })}</p>
			)}
		</StoryFrame>
	);
}

const ORDERS = [
	{ id: '#1044', who: 'Maya L.', items: 2, totalCents: 5600 },
	{ id: '#1043', who: 'Leo P.', items: 1, totalCents: 2400 },
	{ id: '#1042', who: 'Ana R.', items: 3, totalCents: 7100 },
] as const;
/** A new order lands on top of the day's list. */
const ORDERS_BEATS = [1400, 4000] as const;

function OrdersArt() {
	const [ref, beat] = useStory<HTMLDivElement>(ORDERS_BEATS);
	const landed = beat === 1;
	const shown = landed ? ORDERS : ORDERS.slice(1);
	return (
		<StoryFrame storyRef={ref} className="mx-auto w-[260px] text-center">
			<p className="text-[16px] font-bold">
				<T text="<count></count> orders today" components={{ count: () => <NumberTicker key={landed ? 'landed' : 'waiting'} startValue={11} value={landed ? 12 : 11} /> }} /></p>
			<p className={cn(MONO, 'mt-0.5')}>{t("Saved in your store")}</p>
			<div className="mt-4 grid gap-2 text-left">
				{shown.map((order, index) => (
					<div
						key={order.id}
						className={cn(MINI, 'px-4 py-3', landed && index === 0 && 'animate-public-rise border-[#c9dbff] bg-[#eef4ff]', index > 1 && 'opacity-60')}
					>
						<p className="text-[14px] font-semibold">
							{order.id} · {order.who}
						</p>
						<p className={cn(MONO, 'mt-0.5')}>
							{tn('{count} item', '{count} items', order.items)} • {formatUsd(order.totalCents, getLocale())}
						</p>
					</div>
				))}
			</div>
		</StoryFrame>
	);
}

const REQUEST = msg('Make the hero warmer');
/** The request is typed, then the store answers and its hero warms up. */
const CHAT_BEATS = [700, 1500, 4200] as const;

function ChatArt() {
	const [ref, beat] = useStory<HTMLDivElement>(CHAT_BEATS);
	const request = t(REQUEST);
	const typed = useTypedText(request, beat === 1);
	const done = beat === 2;
	return (
		<StoryFrame storyRef={ref} className="mx-auto w-[300px]">
			<div className={cn(MINI, 'overflow-hidden')}>
				<div className="flex items-center gap-1.5 border-b border-[#f0f0f0] px-3 py-2">
					<span className="size-2 rounded-full bg-[#e5e7eb]" />
					<span className="size-2 rounded-full bg-[#e5e7eb]" />
					<span className="size-2 rounded-full bg-[#e5e7eb]" />
					<span className={cn(MONO, 'ml-2 text-[11px]')}>northridge.estori.app</span>
				</div>
				<div className="relative h-[70px]">
					<span className="absolute inset-0 bg-[linear-gradient(120deg,#e6eefc,#b9cdf4)]" />
					<span className={cn('absolute inset-0 bg-[linear-gradient(120deg,#f8e8d4,#e8b48a)] transition-opacity duration-1000', done ? 'opacity-100' : 'opacity-0')} />
					<span className="absolute top-4 left-4 h-2.5 w-28 rounded-full bg-white/80" />
					<span className="absolute top-9 left-4 h-2.5 w-20 rounded-full bg-white/60" />
				</div>
			</div>
			<p className="mt-3 ml-auto w-fit max-w-[230px] rounded-[12px] rounded-br-[4px] bg-public-blue px-3.5 py-2 text-[13px] text-white">
				{beat === 0 ? ' ' : done ? request : typed}
			</p>
			{done && (
				<div className={cn(MINI, 'mt-2 flex w-fit animate-public-rise items-center gap-2 px-3 py-2')}>
					<SparkleIcon weight="fill" className="size-4 text-public-blue" />
					<span className="text-[13px]">{t("Done. The live store is updated.")}</span>
				</div>
			)}
		</StoryFrame>
	);
}

/** The preview switches between desktop and phone. */
const PREVIEW_BEATS = [2600, 2600] as const;

/** The preview card's story, shared by its device switch and its picture so the two always change together. */
export function PreviewStory({ children }: { children: (storyRef: Ref<HTMLElement>, phone: boolean) => ReactNode }) {
	const [ref, beat] = useStory<HTMLElement>(PREVIEW_BEATS);
	return children(ref, beat === 1);
}

/** The device switch on the preview card's link row. Decorative: the card's text says what it shows. */
export function DeviceSwitch({ phone }: { phone: boolean }) {
	return (
		<span aria-hidden className="flex items-center gap-0.5 rounded-full bg-white p-0.5 text-[12px] ring-1 ring-[#ececec]">
			{[
				{ label: msg('Desktop'), icon: DesktopIcon, on: !phone },
				{ label: msg('Phone'), icon: DeviceMobileIcon, on: phone },
			].map((option) => (
				<span
					key={option.label}
					className={cn(
						'flex items-center gap-1.5 rounded-full px-2.5 py-0.5 transition-colors duration-300 motion-reduce:transition-none',
						option.on ? 'bg-public-charcoal text-white' : MUTED,
					)}
				>
					<option.icon className="size-3.5" />
					{t(option.label)}
				</span>
			))}
		</span>
	);
}

/** The store on desktop with its phone view beside it; whichever the switch shows is ringed in blue. */
export function PreviewArt({ phone }: { phone: boolean }) {
	return (
		<ArtCanvas width={ART_WIDTH} height={ART_HEIGHT} className="mt-auto px-6 pt-2">
			<div className="relative mx-auto w-[330px] pt-2">
				<div className={cn(MINI, 'overflow-hidden transition-[box-shadow] duration-300', !phone && 'ring-2 ring-public-blue')}>
					<div className="flex items-center gap-1.5 border-b border-[#f0f0f0] px-3 py-1.5">
						<span className="size-1.5 rounded-full bg-[#16a34a]" />
						<span className={cn(MONO, 'text-[11px]')}>{t("Live preview")}</span>
					</div>
					<Photo src={PREVIEW_SHOTS.desktop} className="h-[230px] w-full object-top" />
				</div>
				<div
					className={cn(
						'absolute right-[-18px] bottom-[-40px] h-[200px] w-[92px] overflow-hidden rounded-[18px] border-[4px] border-[#1d2433] bg-white shadow-[0_10px_24px_rgba(17,24,39,0.18)] transition-transform duration-500 motion-reduce:transition-none',
						phone ? '-translate-y-3 ring-2 ring-public-blue' : '',
					)}
				>
					<Photo src={PREVIEW_SHOTS.phone} className="h-full w-full object-top" />
				</div>
			</div>
		</ArtCanvas>
	);
}

/** The store is picked, Use is tapped, and the copy is ready. */
const DISCOVER_BEATS = [1500, 500, 3800] as const;

function DiscoverArt() {
	const [ref, beat] = useStory<HTMLDivElement>(DISCOVER_BEATS);
	const copied = beat === 2;
	return (
		<StoryFrame storyRef={ref} className="mx-auto w-[300px]">
			<div className={cn(MINI, 'overflow-hidden')}>
				<Photo src={DISCOVER_SHOT} className="h-[124px] w-full object-top" />
				<div className="flex items-center justify-between gap-3 px-4 py-3">
					<span className="min-w-0">
						<span className="block truncate text-[14px] font-semibold">Seed Sun Sprout</span>
						<span className={cn(MONO, 'block')}>{t("Free · Garden")}</span>
					</span>
					<span
						className={cn(
							'shrink-0 rounded-full px-3 py-1 text-[12px] font-medium text-white transition-transform duration-150',
							beat === 1 ? 'scale-90 bg-public-blue-hover' : 'bg-public-blue',
						)}
					>{t("Use this store")}</span>
				</div>
			</div>
			<div className="mt-2 h-10">
				{copied && (
					<div className={cn(MINI, 'flex animate-public-rise items-center justify-between px-4 py-2.5')}>
						<Done>{t("Your copy is ready")}</Done>
						<span className={MONO}>{t("Open in builder")}</span>
					</div>
				)}
			</div>
		</StoryFrame>
	);
}

const ARTS: Readonly<Record<Exclude<StoreFeatureId, 'preview'>, () => ReactNode>> = {
	catalog: CatalogArt,
	checkout: CheckoutArt,
	orders: OrdersArt,
	chat: ChatArt,
	discover: DiscoverArt,
};

/** A feature at work, at the bottom of its card. The preview card draws its own, in step with its switch. */
export function FeatureArt({ id }: { id: Exclude<StoreFeatureId, 'preview'> }) {
	const Art = ARTS[id];
	return (
		<ArtCanvas width={ART_WIDTH} height={ART_HEIGHT} className="mt-auto px-6 pt-2">
			<Art />
		</ArtCanvas>
	);
}
