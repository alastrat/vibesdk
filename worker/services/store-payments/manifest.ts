/** Reads and validates a store's `estori-store.json`. Every error names its JSON path. Pure. */

import {
	STORE_MANIFEST_FILE,
	STORE_PRICE_MAX_CENTS,
	STORE_PRICE_MIN_CENTS,
	type StoreManifest,
	type StoreManifestProduct,
	type StoreManifestVariant,
	type StoreShipping,
} from '../../../shared/types/store-payments';

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
	check.onlyKeys(value, ['id', 'name', 'description', 'image', 'variants'], path);
	const { id, name, description, image, variants } = value;
	if (typeof id !== 'string' || !ID.test(id)) check.fail(`${path}.id`, 'lowercase letters, digits and dashes, starting with a letter or digit');
	if (!isText(name, MAX_NAME)) check.fail(`${path}.name`, `text of 1 to ${MAX_NAME} characters`);
	if (description !== undefined && !isText(description, MAX_DESCRIPTION)) check.fail(`${path}.description`, `text of 1 to ${MAX_DESCRIPTION} characters`);
	if (image !== undefined && !isImage(image)) check.fail(`${path}.image`, 'a path on the store such as /images/mug.jpg, or an https address');
	if (!Array.isArray(variants) || variants.length === 0) {
		check.fail(`${path}.variants`, 'at least one variant');
		return null;
	}
	const read = variants.map((variant, index) => readVariant(check, variant, `${path}.variants[${index}]`, seen));
	if (typeof id !== 'string' || !isText(name, MAX_NAME)) return null;
	return {
		id,
		name,
		...(typeof description === 'string' && { description }),
		...(typeof image === 'string' && { image }),
		variants: read.filter((variant): variant is StoreManifestVariant => variant !== null),
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
	check.onlyKeys(value, ['version', 'currency', 'shipping', 'products'], '');
	if (value.version !== 1) check.fail('version', 'must be 1');
	if (value.currency !== 'usd') check.fail('currency', 'must be "usd"');
	const shipping = readShipping(check, value.shipping);
	const { products } = value;
	const read: StoreManifestProduct[] = [];
	if (!Array.isArray(products) || products.length === 0) {
		check.fail('products', 'at least one product');
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
	if (check.errors.length > 0 || !shipping) return { ok: false, errors: check.errors };
	return { ok: true, manifest: { version: 1, currency: 'usd', shipping, products: read } };
}
