import { describe, expect, it } from 'vitest';
import type { ApiResponse } from '@/api-types';
import { unwrap } from './unwrap-response';

describe('unwrap', () => {
	it('returns the data of a successful response', async () => {
		const response: ApiResponse<{ url: string }> = { success: true, data: { url: 'https://example.com' } };
		await expect(unwrap(Promise.resolve(response), 'fallback')).resolves.toEqual({ url: 'https://example.com' });
	});

	it('throws the server message on a failed response', async () => {
		const response: ApiResponse<string> = { success: false, error: { message: 'You already own this site', name: 'Error' } };
		await expect(unwrap(Promise.resolve(response), 'fallback')).rejects.toThrow('You already own this site');
	});

	it('throws the fallback when a failed response carries no message', async () => {
		const response: ApiResponse<string> = { success: false };
		await expect(unwrap(Promise.resolve(response), 'Failed to load')).rejects.toThrow('Failed to load');
	});
});
