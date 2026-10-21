import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { 
	type ImageAttachment, 
	isSupportedImageType, 
	MAX_IMAGE_SIZE_BYTES,
	MAX_IMAGES_PER_MESSAGE,
	SUPPORTED_IMAGE_MIME_TYPES
} from '@/api-types';
import { downscaleImageFile } from '@/utils/image-resize';
import { getLocale, t, tn } from '@/lib/i18n';
import { perLocale } from '../../shared/i18n/format';

const megabytes = perLocale((intl) => new Intl.NumberFormat(intl, { minimumFractionDigits: 1, maximumFractionDigits: 1 }));

export interface UseImageUploadOptions {
	maxImages?: number;
	maxSizeBytes?: number;
	onError?: (error: string) => void;
}

export interface UseImageUploadReturn {
	images: ImageAttachment[];
	addImages: (files: File[]) => Promise<void>;
	removeImage: (id: string) => void;
	clearImages: () => void;
	isProcessing: boolean;
}

/**
 * Hook for handling image uploads. It shows each error as a toast, once, so callers' `onError` only needs to log or react.
 */
export function useImageUpload(options: UseImageUploadOptions = {}): UseImageUploadReturn {
	const {
		maxImages = MAX_IMAGES_PER_MESSAGE,
		maxSizeBytes = MAX_IMAGE_SIZE_BYTES,
		onError,
	} = options;

	const [images, setImages] = useState<ImageAttachment[]>([]);
	const [isProcessing, setIsProcessing] = useState(false);

	const fail = useCallback((message: string) => {
		toast.error(message);
		onError?.(message);
	}, [onError]);

	const processImageFile = useCallback(async (file: File): Promise<ImageAttachment | null> => {
		// Validate MIME type
		if (!isSupportedImageType(file.type)) {
			const supportedTypes = SUPPORTED_IMAGE_MIME_TYPES.map(mimeType => mimeType.replace('image/', '').toUpperCase());
			fail(t('Unsupported image type: {type}. Only {types} are supported.', { type: file.type, types: supportedTypes.join(', ') }));
			return null;
		}

		// Validate file size
		if (file.size > maxSizeBytes) {
			const locale = getLocale();
			fail(t('Image too large: {size}MB. Maximum allowed is {max}MB.', {
				size: megabytes(locale).format(file.size / (1024 * 1024)),
				max: megabytes(locale).format(maxSizeBytes / (1024 * 1024)),
			}));
			return null;
		}

		try {
			const resized = await downscaleImageFile(file);
			return {
				id: `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
				filename: file.name,
				mimeType: resized.mimeType,
				base64Data: resized.base64Data,
				size: resized.size,
				dimensions: { width: resized.width, height: resized.height },
			};
		} catch (error) {
			console.error('Failed to process image:', error);
			fail(t('Could not read image: {name}', { name: file.name }));
			return null;
		}
	}, [maxSizeBytes, fail]);

	const addImages = useCallback(async (files: File[]) => {
		setIsProcessing(true);

		try {
			// Check if adding these files would exceed the limit
			if (images.length + files.length > maxImages) {
				fail(tn('Maximum {count} image allowed per message.', 'Maximum {count} images allowed per message.', maxImages));
				return;
			}

			// Process all files
			const processedImages = await Promise.all(
				files.map(file => processImageFile(file))
			);

			// Filter out null results (failed validations)
			const validImages = processedImages.filter((img): img is ImageAttachment => img !== null);

			if (validImages.length > 0) {
				setImages(prev => [...prev, ...validImages]);
			}
		} catch (error) {
			fail(error instanceof Error ? error.message : t('Failed to process images'));
		} finally {
			setIsProcessing(false);
		}
	}, [images.length, maxImages, processImageFile, fail]);

	const removeImage = useCallback((id: string) => {
		setImages(prev => prev.filter(img => img.id !== id));
	}, []);

	const clearImages = useCallback(() => {
		setImages([]);
	}, []);

	return {
		images,
		addImages,
		removeImage,
		clearImages,
		isProcessing,
	};
}
