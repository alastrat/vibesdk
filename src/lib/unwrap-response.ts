import type { ApiResponse } from '@/api-types';

/** The data of a successful response, or an error carrying the server's message. */
export async function unwrap<T>(request: Promise<ApiResponse<T>>, fallback: string): Promise<T> {
	const response = await request;
	if (!response.success || response.data === undefined) {
		throw new Error(response.error?.message || fallback);
	}
	return response.data;
}
