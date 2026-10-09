/** Longest edge, in pixels, of images uploaded for the model. */
export const MAX_IMAGE_EDGE = 1600;

/** The largest size within `maxEdge` that keeps the aspect ratio; never upscales. */
export function fitWithin(width: number, height: number, maxEdge = MAX_IMAGE_EDGE): { width: number; height: number } {
	const longest = Math.max(width, height);
	if (longest <= maxEdge || longest === 0) return { width, height };
	const scale = maxEdge / longest;
	return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export interface ResizedImage {
	/** Base64 without a data URL prefix. */
	base64Data: string;
	mimeType: 'image/webp' | 'image/jpeg' | 'image/png';
	width: number;
	height: number;
	size: number;
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
 * JPEG where the browser cannot encode WebP. Images that already fit keep their file.
 */
export async function downscaleImageFile(file: File): Promise<ResizedImage> {
	const bitmap = await createImageBitmap(file);
	const target = fitWithin(bitmap.width, bitmap.height);
	if (target.width === bitmap.width && target.height === bitmap.height) {
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
	context.drawImage(bitmap, 0, 0, target.width, target.height);
	bitmap.close();
	let blob = await canvasToBlob(canvas, 'image/webp', 0.85);
	if (blob.type !== 'image/webp') blob = await canvasToBlob(canvas, 'image/jpeg', 0.85);
	return {
		base64Data: await blobToBase64(blob),
		mimeType: blob.type as ResizedImage['mimeType'],
		width: target.width,
		height: target.height,
		size: blob.size,
	};
}
