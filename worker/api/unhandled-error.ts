/**
 * The answer to an error no route handled. A security error, such as a rate limit, carries its own status and is the
 * client's doing, so it is answered as such, neither logged nor reported. Anything else is logged, and so reported to
 * PostHog, then answered as a plain 500.
 */

import type { ErrorHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { SecurityError } from 'shared/types/errors';
import { createLogger } from '../logger';
import type { AppEnv } from '../types/appenv';
import { errorResponse } from './responses';

const logger = createLogger('UnhandledApiError');

export const unhandledApiError: ErrorHandler<AppEnv> = (error, c) => {
	if (error instanceof HTTPException) return error.getResponse();
	if (error instanceof SecurityError) return errorResponse(error, error.statusCode);
	logger.error('Unhandled API error', error, { method: c.req.method, path: new URL(c.req.url).pathname });
	return errorResponse('Internal server error', 500);
};
