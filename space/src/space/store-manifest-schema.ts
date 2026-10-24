/** Reads and validates a store's `estori-store.json`. Every error names its JSON path. Pure. */

export const STORE_MANIFEST_FILE = 'estori-store.json';
export const STORE_PRICE_MIN_CENTS = 50;
export const STORE_PRICE_MAX_CENTS = 1_000_000;

export interface StoreManifestVariant {
	id: string;
	name: string;
	/** The seller's retail price for one unit. */
	priceCents: number;
	available?: boolean;
	/** Set on catalog products: the catalog variant this sells. The catalog price never appears in the file. */
	catalogVariantId?: string;
}

export interface StoreManifestProduct {
	type?: 'physical' | 'digital';
	accountProductId?: string;
	downloadAssetIds?: string[];
	id: string;
	name: string;
	description?: string;
	image?: string;
	variants: StoreManifestVariant[];
}

export interface StoreShipping {
	/** ISO 3166-1 alpha-2 codes. */
	countries: string[];
	/** Per order; 0 is free shipping. */
	flatRateCents: number;
	/** Shipping is free for subtotals at or above it. */
	freeOverCents?: number;
}

export const STORE_BRAND_CORNERS = ['square', 'rounded', 'pill'] as const;
export type StoreBrandCorners = (typeof STORE_BRAND_CORNERS)[number];

/** How the store looks, for Estori's checkout page and Stripe's payment fields. Colors are #rrggbb. */
export interface StoreBrand {
	name: string;
	/** A path on the store, or an absolute address. */
	logo?: string;
	colors: { background: string; surface: string; text: string; accent: string; accentText: string };
	/** A Google Fonts family name. */
	font?: string;
	corners: StoreBrandCorners;
}

export interface StoreManifest {
	version: 1;
	currency: 'usd';
	shipping: StoreShipping;
	products: StoreManifestProduct[];
	/** Optional: a store without it gets a neutral checkout page. */
	brand?: StoreBrand;
}

export type ManifestResult = { ok: true; manifest: StoreManifest } | { ok: false; errors: string[] };

const MAX_BYTES = 256 * 1024;
const MAX_PRODUCTS = 200;
const MAX_VARIANTS = 1000;
const MAX_COUNTRIES = 50;
const MAX_NAME = 200;
const MAX_DESCRIPTION = 5000;
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const CATALOG_VARIANT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const COUNTRY = /^[A-Z]{2}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const FONT = /^[A-Za-z0-9 ]{1,40}$/;
const MAX_BRAND_NAME = 80;

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isText(value: unknown, max: number): value is string {
	return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

/** A path on the store, or an absolute address: catalog images are served by Estori, not by the store. */
function isImage(value: unknown): value is string {
	if (typeof value !== 'string' || value.length > 2048) return false;
	if (value.startsWith('/')) return !value.startsWith('//');
	return /^https?:\/\/\S+$/.test(value);
}

class Checker {
	readonly errors: string[] = [];

	fail(path: string, message: string): void {
		this.errors.push(`${path}: ${message}`);
	}

	onlyKeys(value: JsonObject, allowed: readonly string[], path: string): void {
		for (const key of Object.keys(value)) {
			if (!allowed.includes(key)) this.fail(path ? `${path}.${key}` : key, 'unknown field');
		}
	}
}

function readShipping(check: Checker, value: unknown): StoreShipping | null {
	if (!isObject(value)) {
		check.fail('shipping', 'an object with countries and flatRateCents');
		return null;
	}
	check.onlyKeys(value, ['countries', 'flatRateCents', 'freeOverCents'], 'shipping');
	const { countries, flatRateCents, freeOverCents } = value;
	if (!Array.isArray(countries) || countries.length === 0 || countries.length > MAX_COUNTRIES) {
		check.fail('shipping.countries', `1 to ${MAX_COUNTRIES} country codes`);
	} else {
		countries.forEach((country, index) => {
			if (typeof country !== 'string' || !COUNTRY.test(country)) check.fail(`shipping.countries[${index}]`, 'a two-letter country code such as US');
		});
	}
	if (!isCount(flatRateCents)) check.fail('shipping.flatRateCents', 'whole cents, 0 or more');
	if (freeOverCents !== undefined && !isCount(freeOverCents)) check.fail('shipping.freeOverCents', 'whole cents, 0 or more');
	if (!Array.isArray(countries) || !isCount(flatRateCents)) return null;
	return {
		countries: countries.filter((country): country is string => typeof country === 'string'),
		flatRateCents,
		...(isCount(freeOverCents) && { freeOverCents }),
	};
}

function readVariant(check: Checker, value: unknown, path: string, seen: Set<string>): StoreManifestVariant | null {
	if (!isObject(value)) {
		check.fail(path, 'an object with id, name and priceCents');
		return null;
	}
	check.onlyKeys(value, ['id', 'name', 'priceCents', 'available', 'catalogVariantId'], path);
	const { id, name, priceCents, available, catalogVariantId } = value;
	if (typeof id !== 'string' || !ID.test(id)) check.fail(`${path}.id`, 'lowercase letters, digits and dashes, starting with a letter or digit');
	else if (seen.has(id)) check.fail(`${path}.id`, `duplicate variant id "${id}"`);
	if (!isText(name, MAX_NAME)) check.fail(`${path}.name`, `text of 1 to ${MAX_NAME} characters`);
	const pricedRight = typeof priceCents === 'number' && Number.isInteger(priceCents) && priceCents >= STORE_PRICE_MIN_CENTS && priceCents <= STORE_PRICE_MAX_CENTS;
	if (!pricedRight) check.fail(`${path}.priceCents`, `whole cents from ${STORE_PRICE_MIN_CENTS} to ${STORE_PRICE_MAX_CENTS}`);
	if (available !== undefined && typeof available !== 'boolean') check.fail(`${path}.available`, 'true or false');
	if (catalogVariantId !== undefined && (typeof catalogVariantId !== 'string' || !CATALOG_VARIANT_ID.test(catalogVariantId))) {
		check.fail(`${path}.catalogVariantId`, 'a catalog variant id');
	}
	if (typeof id !== 'string' || !isText(name, MAX_NAME) || !pricedRight) return null;
	seen.add(id);
	return {
		id,
		name,
		priceCents: priceCents as number,
		...(typeof available === 'boolean' && { available }),
		...(typeof catalogVariantId === 'string' && { catalogVariantId }),
	};
}

function readProduct(check: Checker, value: unknown, path: string, seen: Set<string>): StoreManifestProduct | null {
	if (!isObject(value)) {
		check.fail(path, 'an object with id, name and variants');
		return null;
	}
	check.onlyKeys(value, ['id', 'name', 'description', 'image', 'variants', 'type', 'accountProductId', 'downloadAssetIds'], path);
	const { id, name, description, image, variants, type, accountProductId, downloadAssetIds } = value;
	if (type !== undefined && type !== 'physical' && type !== 'digital') check.fail(`${path}.type`, 'physical or digital');
	if (accountProductId !== undefined && (typeof accountProductId !== 'string' || !CATALOG_VARIANT_ID.test(accountProductId))) check.fail(`${path}.accountProductId`, 'a safe opaque product id');
	if (downloadAssetIds !== undefined && (!Array.isArray(downloadAssetIds) || downloadAssetIds.length > 10 || downloadAssetIds.some((id) => typeof id !== 'string' || !CATALOG_VARIANT_ID.test(id)) || new Set(downloadAssetIds).size !== downloadAssetIds.length)) check.fail(`${path}.downloadAssetIds`, 'up to 10 unique safe asset ids');
	if (downloadAssetIds !== undefined && type !== 'digital') check.fail(`${path}.downloadAssetIds`, 'only digital products have downloads');
	if (typeof id !== 'string' || !ID.test(id)) check.fail(`${path}.id`, 'lowercase letters, digits and dashes, starting with a letter or digit');
	if (!isText(name, MAX_NAME)) check.fail(`${path}.name`, `text of 1 to ${MAX_NAME} characters`);
	if (description !== undefined && !isText(description, MAX_DESCRIPTION)) check.fail(`${path}.description`, `text of 1 to ${MAX_DESCRIPTION} characters`);
	if (image !== undefined && !isImage(image)) check.fail(`${path}.image`, 'a path on the store such as /images/mug.jpg, or an https address');
	if (!Array.isArray(variants) || variants.length === 0) {
		check.fail(`${path}.variants`, 'at least one variant');
		return null;
	}
	const read = variants.map((variant, index) => readVariant(check, variant, `${path}.variants[${index}]`, seen));
	if (type === 'digital' && read.some((variant) => variant?.catalogVariantId !== undefined)) check.fail(`${path}.variants`, 'digital products must be owned products');
	if (typeof id !== 'string' || !isText(name, MAX_NAME)) return null;
	return {
		id,
		name,
		...(typeof description === 'string' && { description }),
		...(typeof image === 'string' && { image }),
		...(type === 'physical' || type === 'digital' ? { type } : {}),
		...(typeof accountProductId === 'string' ? { accountProductId } : {}),
		...(Array.isArray(downloadAssetIds) ? { downloadAssetIds: downloadAssetIds.filter((id): id is string => typeof id === 'string') } : {}),
		variants: read.filter((variant): variant is StoreManifestVariant => variant !== null),
	};
}

/** WCAG relative luminance of a #rrggbb color. */
function luminance(color: string): number {
	const [r, g, b] = [1, 3, 5].map((start) => {
		const channel = parseInt(color.slice(start, start + 2), 16) / 255;
		return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Black or white, whichever has more contrast on this color. */
function readableOn(color: string): string {
	const light = luminance(color);
	return (light + 0.05) / 0.05 >= 1.05 / (light + 0.05) ? '#000000' : '#ffffff';
}

function readBrand(check: Checker, value: unknown): StoreBrand | null {
	if (!isObject(value)) {
		check.fail('brand', 'an object with name and colors');
		return null;
	}
	check.onlyKeys(value, ['name', 'logo', 'colors', 'font', 'corners'], 'brand');
	const before = check.errors.length;
	if (!isText(value.name, MAX_BRAND_NAME)) check.fail('brand.name', `1 to ${MAX_BRAND_NAME} characters`);
	if (value.logo !== undefined && !isImage(value.logo)) check.fail('brand.logo', 'a path on the store or an https address');
	if (value.font !== undefined && !(typeof value.font === 'string' && FONT.test(value.font))) check.fail('brand.font', 'a font family name: letters, digits and spaces, up to 40');
	if (value.corners !== undefined && !(STORE_BRAND_CORNERS as readonly unknown[]).includes(value.corners)) check.fail('brand.corners', `one of ${STORE_BRAND_CORNERS.join(', ')}`);
	const colors = value.colors;
	if (!isObject(colors)) {
		check.fail('brand.colors', 'an object with background, text and accent');
		return null;
	}
	check.onlyKeys(colors, ['background', 'surface', 'text', 'accent', 'accentText'], 'brand.colors');
	for (const key of ['background', 'text', 'accent'] as const) {
		if (!(typeof colors[key] === 'string' && COLOR.test(colors[key] as string))) check.fail(`brand.colors.${key}`, 'a #rrggbb color');
	}
	for (const key of ['surface', 'accentText'] as const) {
		if (colors[key] !== undefined && !(typeof colors[key] === 'string' && COLOR.test(colors[key] as string))) check.fail(`brand.colors.${key}`, 'a #rrggbb color');
	}
	if (check.errors.length > before) return null;
	const background = (colors.background as string).toLowerCase();
	const accent = (colors.accent as string).toLowerCase();
	return {
		name: (value.name as string).trim(),
		...(value.logo !== undefined ? { logo: value.logo as string } : {}),
		colors: {
			background,
			surface: typeof colors.surface === 'string' ? colors.surface.toLowerCase() : background,
			text: (colors.text as string).toLowerCase(),
			accent,
			accentText: typeof colors.accentText === 'string' ? colors.accentText.toLowerCase() : readableOn(accent),
		},
		...(value.font !== undefined ? { font: value.font as string } : {}),
		corners: (value.corners as StoreBrand['corners'] | undefined) ?? 'rounded',
	};
}

export function parseStoreManifest(text: string): ManifestResult {
	if (new TextEncoder().encode(text).byteLength > MAX_BYTES) return { ok: false, errors: [`${STORE_MANIFEST_FILE}: at most 256 KB`] };
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return { ok: false, errors: [`${STORE_MANIFEST_FILE}: not valid JSON`] };
	}
	const check = new Checker();
	if (!isObject(value)) return { ok: false, errors: [`${STORE_MANIFEST_FILE}: an object with version, currency, shipping and products`] };
	check.onlyKeys(value, ['version', 'currency', 'shipping', 'products', 'brand'], '');
	if (value.version !== 1) check.fail('version', 'must be 1');
	if (value.currency !== 'usd') check.fail('currency', 'must be "usd"');
	const shipping = readShipping(check, value.shipping);
	const { products } = value;
	const read: StoreManifestProduct[] = [];
	if (!Array.isArray(products)) {
		check.fail('products', 'an array of products');
	} else if (products.length > MAX_PRODUCTS) {
		check.fail('products', `at most ${MAX_PRODUCTS} products`);
	} else {
		const seen = new Set<string>();
		products.forEach((product, index) => {
			const parsed = readProduct(check, product, `products[${index}]`, seen);
			if (parsed) read.push(parsed);
		});
		if (seen.size > MAX_VARIANTS) check.fail('products', `at most ${MAX_VARIANTS} variants in all`);
	}
	const brand = value.brand === undefined ? undefined : readBrand(check, value.brand);
	if (check.errors.length > 0 || !shipping) return { ok: false, errors: check.errors };
	return { ok: true, manifest: { version: 1, currency: 'usd', shipping, products: read, ...(brand ? { brand } : {}) } };
}
