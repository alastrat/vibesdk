import { SecurityError, SecurityErrorType } from '@/api-types';

/** True for the API's 403, so admin pages can say "Admins only" instead of a load error. */
export function isForbiddenError(error: unknown): boolean {
	return error instanceof SecurityError && error.type === SecurityErrorType.FORBIDDEN;
}
