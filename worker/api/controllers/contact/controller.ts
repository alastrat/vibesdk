import { msg } from '../../../../shared/i18n/translate';
/** Contact-sales requests: anyone can send one, and admins can read them. */

import { BaseController } from '../baseController';
import type { ApiResponse, ControllerResponse } from '../types';
import type { RouteContext } from '../../types/route-context';
import { createLogger } from '../../../logger';
import { ContactService } from '../../../database';
import { createEmailSender } from '../../../services/email/sender';
import { RateLimitService } from '../../../services/rate-limit/rateLimits';
import { CONTACT_FAILED_MESSAGE, CONTACT_LIMITED_MESSAGE } from '../../../../shared/types/contact';
import { RateLimitExceededError } from '../../../../shared/types/errors';
import { toContactAdminData } from './contactDto';
import { submitContact } from './submitContact';
import type { ContactAdminData, ContactReceivedData } from './types';

/** True when the check passes, false when it reports the limit was reached; other errors propagate. */
async function withinLimit(check: () => Promise<void>): Promise<boolean> {
	try {
		await check();
		return true;
	} catch (error) {
		if (error instanceof RateLimitExceededError) return false;
		throw error;
	}
}

export class ContactController extends BaseController {
	static logger = createLogger('ContactController');

	/** Stores the request and emails the sender that we'll be in touch. */
	static async submit(
		request: Request,
		env: Env,
		_ctx: ExecutionContext,
		context: RouteContext,
	): Promise<ControllerResponse<ApiResponse<ContactReceivedData>>> {
		try {
			const bodyResult = await ContactController.parseJsonBody<unknown>(request);
			if (!bodyResult.success) {
				return bodyResult.response! as ControllerResponse<ApiResponse<ContactReceivedData>>;
			}
			const sender = createEmailSender(env);
			const service = new ContactService(env);
			const limits = context.config.security.rateLimit;
			const result = await submitContact(bodyResult.data, {
				isLimited: async () => !(await withinLimit(() => RateLimitService.enforceContactSalesRateLimit(env, limits, request))),
				canConfirm: (email) => withinLimit(() => RateLimitService.enforceContactRecipientRateLimit(env, limits, email)),
				store: (input) => service.create(input),
				send: async (email) => {
					if (!sender) throw new Error('Email sending is not configured');
					await sender.send(email);
				},
				teamInbox: env.SALES_INBOX?.trim() || null,
				log: (message, error) => this.logger.error(message, error),
			});
			if (result.status === 'invalid') {
				return ContactController.createErrorResponse<ContactReceivedData>(result.error, 400);
			}
			if (result.status === 'limited') {
				return ContactController.createErrorResponse<ContactReceivedData>(CONTACT_LIMITED_MESSAGE, 429);
			}
			return ContactController.createSuccessResponse<ContactReceivedData>({ received: true, confirmationSent: result.confirmationSent });
		} catch (error) {
			this.logger.error('Error saving a contact request', error);
			return ContactController.createErrorResponse<ContactReceivedData>(CONTACT_FAILED_MESSAGE, 500);
		}
	}

	static async listAll(
		_request: Request,
		env: Env,
		_ctx: ExecutionContext,
		_context: RouteContext,
	): Promise<ControllerResponse<ApiResponse<ContactAdminData>>> {
		try {
			return ContactController.createSuccessResponse<ContactAdminData>(toContactAdminData(await new ContactService(env).listRecent()));
		} catch (error) {
			this.logger.error('Error listing contact requests', error);
			return ContactController.createErrorResponse<ContactAdminData>(msg("Couldn't load the contact requests"), 500);
		}
	}
}
