/** Longest edge, in pixels, of images uploaded for the model. */
export const MAX_IMAGE_EDGE = 1600;

/** Largest file uploaded unchanged; base64-encoded, it stays under the provider's 5 MB image limit. */
export const MAX_ORIGINAL_IMAGE_BYTES = 3.5 * 1024 * 1024;

/** The largest size within `maxEdge` that keeps the aspect ratio; never upscales. */
export function fitWithin(width: number, height: number, maxEdge = MAX_IMAGE_EDGE): { width: number; height: number } {
	const longest = Math.max(width, height);
	if (longest <= maxEdge || longest === 0) return { width, height };
	const scale = maxEdge / longest;
	return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Whether an image can be uploaded as its original file instead of being re-encoded. */
export function keepsOriginalFile(width: number, height: number, size: number): boolean {
	const target = fitWithin(width, height);
	return target.width === width && target.height === height && size <= MAX_ORIGINAL_IMAGE_BYTES;
}

export interface ResizedImage {
	/** Base64 without a data URL prefix. */
	base64Data: string;
	mimeType: 'image/webp' | 'image/jpeg' | 'image/png';
	width: number;
	height: number;
	size: number;
}

/**
 * JPEG has no alpha channel, so the fallback re-encode needs a backdrop or
 * transparent pixels turn black. Null when the output is already WebP.
 */
export function jpegFallbackFor(webpAttemptType: string): { mimeType: 'image/jpeg'; backdrop: string } | null {
	return webpAttemptType === 'image/webp' ? null : { mimeType: 'image/jpeg', backdrop: '#ffffff' };
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
	return new Promise((resolve, reject) =>
		canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the image'))), type, quality),
	);
}

function blobToBase64(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
		reader.onerror = () => reject(new Error('Could not read the image'));
		reader.readAsDataURL(blob);
	});
}

/**
 * Downscales an image to at most MAX_IMAGE_EDGE on its long edge, as WebP, or
 * JPEG where the browser cannot encode WebP. Images that already fit keep their
 * file unless it is over MAX_ORIGINAL_IMAGE_BYTES; those are re-encoded at their size.
 */
export async function downscaleImageFile(file: File): Promise<ResizedImage> {
	const bitmap = await createImageBitmap(file);
	const target = fitWithin(bitmap.width, bitmap.height);
	if (keepsOriginalFile(bitmap.width, bitmap.height, file.size)) {
		bitmap.close();
		return {
			base64Data: await blobToBase64(file),
			mimeType: file.type as ResizedImage['mimeType'],
			width: target.width,
			height: target.height,
			size: file.size,
		};
	}
	const canvas = document.createElement('canvas');
	canvas.width = target.width;
	canvas.height = target.height;
	const context = canvas.getContext('2d');
	if (!context) {
		bitmap.close();
		throw new Error('Canvas is not available');
	}
	context.imageSmoothingQuality = 'high';
	context.drawImage(bitmap, 0, 0, target.width, target.height);
	bitmap.close();
	let blob = await canvasToBlob(canvas, 'image/webp', 0.85);
	const fallback = jpegFallbackFor(blob.type);
	if (fallback) {
		context.globalCompositeOperation = 'destination-over';
		context.fillStyle = fallback.backdrop;
		context.fillRect(0, 0, target.width, target.height);
		blob = await canvasToBlob(canvas, fallback.mimeType, 0.85);
	}
	return {
		base64Data: await blobToBase64(blob),
		mimeType: blob.type as ResizedImage['mimeType'],
		width: target.width,
		height: target.height,
		size: blob.size,
	};
}
