import { msg } from '../../../shared/i18n/translate';
import { and, eq } from 'drizzle-orm';
import type { ProductAsset } from '../../../shared/types/account-products';
import { BaseService } from '../../database/services/BaseService';
import { productAssets } from '../../database/schema';
import { ProductError, validateUpload } from './validation';
export const PRODUCT_ASSET_MAX_BYTES = 20 * 1024 * 1024;
export async function readBoundedBody(
	request: Request,
	max = PRODUCT_ASSET_MAX_BYTES,
): Promise<Uint8Array> {
	const declared = request.headers.get('content-length');
	if (declared && (!/^\d+$/.test(declared) || Number(declared) > max))
		throw new ProductError(msg('Payload exceeds the size limit'), 413);
	if (!request.body) throw new ProductError(msg('Payload is empty'));
	const reader = request.body.getReader();
	// A fixed buffer also bounds overhead when a sender supplies many tiny chunks.
	const bytes = new Uint8Array(max);
	let size = 0;
	try {
		while (true) {
			const next = await reader.read();
			if (next.done) break;
			size += next.value.byteLength;
			if (size > max) {
				await reader.cancel();
				throw new ProductError(
					msg('Payload exceeds the size limit'),
					413,
				);
			}
			bytes.set(next.value, size - next.value.byteLength);
		}
	} finally {
		reader.releaseLock();
	}
	if (!size) throw new ProductError(msg('Payload is empty'));
	return bytes.subarray(0, size);
}
function validateImageBytes(type: string, b: Uint8Array): void {
	const ascii = (start: number, end: number) =>
		String.fromCharCode(...b.slice(start, end));
	const ok =
		type === 'image/jpeg'
			? b[0] === 255 && b[1] === 216 && b[2] === 255
			: type === 'image/png'
				? b[0] === 137 &&
					ascii(1, 4) === 'PNG' &&
					b[4] === 13 &&
					b[5] === 10 &&
					b[6] === 26 &&
					b[7] === 10
				: type === 'image/webp'
					? ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP'
					: type === 'image/avif'
						? ascii(4, 8) === 'ftyp' &&
							/avif|avis/.test(ascii(8, 32))
						: false;
	if (!ok)
		throw new ProductError(
			msg('File content does not match image type'),
			415,
		);
}
function validateDownloadBytes(type: string, bytes: Uint8Array): void {
	const ascii = (start: number, end: number) =>
		String.fromCharCode(...bytes.slice(start, end));
	const prefix = ascii(0, Math.min(bytes.length, 256)).trimStart();
	if (
		ascii(0, 2) === 'MZ' ||
		ascii(1, 4) === 'ELF' ||
		prefix.startsWith('#!') ||
		/^<(?:!doctype\s+html|html|svg|script|\?xml)\b/i.test(prefix)
	)
		throw new ProductError(msg('Unsupported file content'), 415);
	const ok =
		type === 'application/pdf'
			? ascii(0, 5) === '%PDF-'
			: type === 'application/epub+zip'
				? ascii(0, 2) === 'PK' && bytes[2] === 3 && bytes[3] === 4
				: type === 'text/plain'
					? !bytes.includes(0)
					: type === 'audio/mpeg'
						? ascii(0, 3) === 'ID3' ||
							(bytes[0] === 255 && (bytes[1] & 224) === 224)
						: type === 'audio/wav'
							? ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE'
							: type === 'audio/ogg'
								? ascii(0, 4) === 'OggS'
								: type === 'audio/mp4' || type === 'video/mp4'
									? ascii(4, 8) === 'ftyp'
									: type === 'video/webm'
										? bytes[0] === 26 &&
											bytes[1] === 69 &&
											bytes[2] === 223 &&
											bytes[3] === 163
										: false;
	if (!ok)
		throw new ProductError(
			msg('File content does not match download type'),
			415,
		);
}
export class ProductAssetService extends BaseService {
	static view(row: typeof productAssets.$inferSelect): ProductAsset {
		return {
			id: row.id,
			name: row.name,
			contentType: row.contentType,
			size: row.size,
			kind: row.kind,
			url: `/api/my-products/assets/${row.id}`,
		};
	}
	async getOwned(
		ownerId: string,
		assetId: string,
	): Promise<{ asset: ProductAsset; key: string } | null> {
		const row = await this.database
			.select()
			.from(productAssets)
			.where(
				and(
					eq(productAssets.id, assetId),
					eq(productAssets.ownerId, ownerId),
				),
			)
			.get();
		return row
			? { asset: ProductAssetService.view(row), key: row.r2Key }
			: null;
	}
	/** Caller must establish paid-order entitlement before using the seller identity here. */
	async getForEntitlement(
		ownerId: string,
		assetId: string,
	): Promise<{ asset: ProductAsset; key: string } | null> {
		return this.getOwned(ownerId, assetId);
	}
	async upload(
		ownerId: string,
		request: Request,
		kind: unknown,
	): Promise<ProductAsset> {
		let name: string;
		try {
			name = decodeURIComponent(request.headers.get('X-File-Name') ?? '');
		} catch {
			throw new ProductError(msg('Invalid filename'));
		}
		const metadata = validateUpload(
			kind,
			request.headers.get('Content-Type') ?? '',
			name,
		);
		const bytes = await readBoundedBody(request);
		if (metadata.kind === 'image')
			validateImageBytes(metadata.contentType, bytes);
		else validateDownloadBytes(metadata.contentType, bytes);
		const id = crypto.randomUUID();
		const key = `private-products/${ownerId}/${id}`;
		await this.env.TEMPLATES_BUCKET.put(key, bytes, {
			httpMetadata: { contentType: metadata.contentType },
		});
		try {
			const row = {
				id,
				ownerId,
				r2Key: key,
				...metadata,
				size: bytes.byteLength,
				createdAt: new Date(),
			};
			await this.database.insert(productAssets).values(row);
			return ProductAssetService.view(row);
		} catch (error) {
			await this.env.TEMPLATES_BUCKET.delete(key);
			throw error;
		}
	}
	async serveOwned(ownerId: string, assetId: string): Promise<Response> {
		const record = await this.getOwned(ownerId, assetId);
		if (!record) throw new ProductError(msg('Asset not found'), 404);
		const object = await this.env.TEMPLATES_BUCKET.get(record.key);
		if (!object) throw new ProductError(msg('Asset not found'), 404);
		const name = record.asset.name
			.replace(/[^A-Za-z0-9._ -]/g, '_')
			.replace(/"/g, '_');
		return new Response(object.body, {
			headers: {
				'Content-Type': record.asset.contentType,
				'Content-Length': String(object.size),
				'Content-Disposition': `${record.asset.kind === 'image' ? 'inline' : 'attachment'}; filename="${name}"; filename*=UTF-8''${encodeURIComponent(record.asset.name)}`,
				'Cache-Control': 'private, no-store',
				'X-Content-Type-Options': 'nosniff',
				'Content-Security-Policy': "default-src 'none'; sandbox",
			},
		});
	}
}
