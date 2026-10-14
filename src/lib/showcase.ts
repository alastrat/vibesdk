import {
	TEMPLATE_CATEGORIES,
	TEMPLATE_CATEGORY_LABELS,
	formatTemplatePrice,
	type PublicAppsData,
	type TemplateCategory,
} from '@/api-types';
import { storeWordmark } from './store-wordmark';

/** The listing fields the landing page reads. */
export type ShowcaseSource = Pick<
	PublicAppsData['apps'][number],
	'id' | 'title' | 'category' | 'priceCents' | 'userName' | 'screenshotUrl' | 'showcaseScreenshotUrl'
>;

export interface ShowcaseStore {
	id: string;
	title: string;
	wordmark: string;
	category: TemplateCategory | null;
	categoryLabel: string | null;
	priceLabel: string;
	isFree: boolean;
	byline: string | null;
	imageUrl: string | null;
	/** The tall showcase capture; false when falling back to the desktop thumbnail. */
	tallImage: boolean;
}

export type ShowcaseFilter = 'all' | TemplateCategory;

export type ShowcaseLayout =
	| { kind: 'static'; row: ShowcaseStore[] }
	| { kind: 'marquee'; rows: [ShowcaseStore[], ShowcaseStore[]] };

/** The logo strip and the showcase each stay hidden below this many stores. */
export const SHOWCASE_MIN_STORES = 3;
/** A set this small shows as one still row; a marquee of so few cards would repeat itself. */
export const SHOWCASE_STATIC_MAX = 3;

export function toShowcaseStore(app: ShowcaseSource): ShowcaseStore {
	const priceCents = app.priceCents ?? 0;
	const category = app.category ?? null;
	return {
		id: app.id,
		title: app.title,
		wordmark: storeWordmark(app.title),
		category,
		categoryLabel: category ? TEMPLATE_CATEGORY_LABELS[category] : null,
		priceLabel: formatTemplatePrice(priceCents),
		isFree: priceCents <= 0,
		byline: app.userName ? `by ${app.userName}` : null,
		imageUrl: app.showcaseScreenshotUrl ?? app.screenshotUrl ?? null,
		tallImage: Boolean(app.showcaseScreenshotUrl),
	};
}

export function shouldShowShowcase(count: number): boolean {
	return count >= SHOWCASE_MIN_STORES;
}

export function storesWithImages(stores: readonly ShowcaseStore[]): ShowcaseStore[] {
	return stores.filter((store) => store.imageUrl !== null);
}

/** "All" plus each category present, in Discover's order; none when the stores share one category. */
export function showcaseFilters(stores: readonly ShowcaseStore[]): ShowcaseFilter[] {
	const present = TEMPLATE_CATEGORIES.filter((category) => stores.some((store) => store.category === category));
	return present.length > 1 ? ['all', ...present] : [];
}

export function showcaseFilterLabel(filter: ShowcaseFilter): string {
	return filter === 'all' ? 'All' : TEMPLATE_CATEGORY_LABELS[filter];
}

export function filterShowcase(stores: readonly ShowcaseStore[], filter: ShowcaseFilter): ShowcaseStore[] {
	return filter === 'all' ? [...stores] : stores.filter((store) => store.category === filter);
}

export function showcaseLayout(stores: readonly ShowcaseStore[]): ShowcaseLayout {
	if (stores.length <= SHOWCASE_STATIC_MAX) return { kind: 'static', row: [...stores] };
	return { kind: 'marquee', rows: [[...stores], [...stores].reverse()] };
}
