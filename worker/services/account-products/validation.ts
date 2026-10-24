import { msg } from '../../../shared/i18n/translate';
import type {
	AccountProductVariant,
	SaveAccountProduct,
} from '../../../shared/types/account-products';
export class ProductError extends Error {
	constructor(
		message: string,
		readonly status: 400 | 403 | 404 | 409 | 413 | 415 = 400,
	) {
		super(message);
	}
}
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ASSET_ID = /^[a-z0-9-]{1,64}$/;
function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new ProductError(msg('Expected an object'));
	return value as Record<string, unknown>;
}
function text(value: unknown, max: number, required = false): string {
	if (
		typeof value !== 'string' ||
		value.length > max ||
		(required && !value.trim())
	)
		throw new ProductError(msg('Invalid product text'));
	return value.trim();
}
export function visibilityOf(value: unknown): 'visible' | 'hidden' {
	if (value !== 'visible' && value !== 'hidden')
		throw new ProductError(msg('Invalid visibility'));
	return value;
}
export function revisionOf(value: unknown): number {
	if (!Number.isSafeInteger(value) || typeof value !== 'number' || value < 1)
		throw new ProductError(msg('A revision is required'));
	return value;
}
export function validateProduct(
	value: unknown,
	existing?: readonly AccountProductVariant[],
	catalog = false,
): SaveAccountProduct {
	const input = object(value);
	if (
		'source' in input ||
		'sourceCatalogProductId' in input ||
		'archived' in input
	)
		throw new ProductError(msg('Protected product field'));
	if (input.type !== 'physical' && input.type !== 'digital')
		throw new ProductError(msg('Choose a physical or digital product'));
	if (catalog && input.type !== 'physical')
		throw new ProductError(msg('Catalog products must be physical'));
	if (
		!Array.isArray(input.variants) ||
		input.variants.length < 1 ||
		input.variants.length > 30
	)
		throw new ProductError(msg('Provide 1 to 30 variants'));
	const ids = new Set<string>();
	const variants = input.variants.map((value): AccountProductVariant => {
		const row = object(value);
		const id = row.id === '' ? crypto.randomUUID() : text(row.id, 64, true);
		if (!ID.test(id) || ids.has(id))
			throw new ProductError(msg('Invalid or duplicate variant ID'));
		if (existing && row.id !== '' && !existing.some((v) => v.id === id))
			throw new ProductError(msg('Unknown variant ID'));
		ids.add(id);
		if (
			typeof row.priceCents !== 'number' ||
			!Number.isInteger(row.priceCents) ||
			row.priceCents < 50 ||
			row.priceCents > 1000000
		)
			throw new ProductError(msg('Price must be 50 to 1000000 cents'));
		if (typeof row.available !== 'boolean')
			throw new ProductError(msg('Invalid availability'));
		const original = existing?.find((v) => v.id === id);
		if (
			row.catalogVariantId !== undefined &&
			(!catalog || row.catalogVariantId !== original?.catalogVariantId)
		)
			throw new ProductError(msg('Invalid catalog variant'));
		if (catalog && !original?.catalogVariantId)
			throw new ProductError(msg('Catalog variants cannot be added'));
		return {
			id,
			name: text(row.name, 200, true),
			sku: text(row.sku, 100),
			priceCents: row.priceCents,
			available: row.available,
			...(original?.catalogVariantId
				? { catalogVariantId: original.catalogVariantId }
				: {}),
		};
	});
	const imageAssetId = input.imageAssetId;
	if (
		imageAssetId !== null &&
		(typeof imageAssetId !== 'string' || !ASSET_ID.test(imageAssetId))
	)
		throw new ProductError(msg('Invalid image'));
	const downloads = input.downloadAssetIds;
	if (
		!Array.isArray(downloads) ||
		downloads.length > 10 ||
		downloads.some((id) => typeof id !== 'string' || !ASSET_ID.test(id)) ||
		new Set(downloads).size !== downloads.length
	)
		throw new ProductError(msg('Invalid downloads'));
	if (input.type === 'physical' && downloads.length)
		throw new ProductError(msg('Physical products cannot have downloads'));
	const weight = input.weightGrams;
	if (
		weight !== null &&
		(typeof weight !== 'number' ||
			!Number.isSafeInteger(weight) ||
			weight < 0 ||
			weight > 1000000)
	)
		throw new ProductError(msg('Invalid weight'));
	return {
		name: text(input.name, 200, true),
		description: text(input.description, 5000),
		category: text(input.category, 100),
		type: input.type,
		variants,
		imageAssetId,
		downloadAssetIds: downloads as string[],
		weightGrams: input.type === 'physical' ? weight : null,
		...(input.revision !== undefined
			? { revision: revisionOf(input.revision) }
			: {}),
		...(input.storeId !== undefined
			? { storeId: text(input.storeId, 128, true) }
			: {}),
		...(input.visibility !== undefined
			? { visibility: visibilityOf(input.visibility) }
			: {}),
	};
}
const IMAGES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
const DOWNLOADS = new Set([
	'application/pdf',
	'text/plain',
	'application/epub+zip',
	'audio/mpeg',
	'audio/mp4',
	'audio/wav',
	'audio/ogg',
	'video/mp4',
	'video/webm',
]);
export function validateUpload(
	kind: unknown,
	contentType: string,
	name: string,
): { kind: 'image' | 'download'; contentType: string; name: string } {
	if (kind !== 'image' && kind !== 'download')
		throw new ProductError(msg('Invalid asset kind'));
	contentType = contentType.split(';')[0].trim().toLowerCase();
	if (!(kind === 'image' ? IMAGES : DOWNLOADS).has(contentType))
		throw new ProductError(msg('Unsupported file type'), 415);
	if (
		!name ||
		name.length > 180 ||
		Array.from(name).some(
			(character) =>
				character.charCodeAt(0) < 32 ||
				character.charCodeAt(0) === 127 ||
				character === '/' ||
				character === '\\',
		) ||
		name === '.' ||
		name === '..'
	)
		throw new ProductError(msg('Invalid filename'));
	if (
		/\.(exe|com|bat|cmd|sh|js|mjs|html?|svg|dll|app|msi|ps1|py|rb|pl|php|vbs|vbe|wsf|hta|jar|scr|dmg|pkg|apk|deb|rpm|wasm|bin|so|dylib)$/i.test(
			name,
		)
	)
		throw new ProductError(msg('Unsupported filename'), 415);
	return { kind, contentType, name };
}
