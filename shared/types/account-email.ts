/** Paths and answers of the account email flows, shared by the server and the pages that show them. */

import { msg } from '../i18n/translate';

export const RESET_PASSWORD_PATH = '/reset-password';
export const VERIFY_EMAIL_PATH = '/verify-email';

export const RESET_LINK_INVALID_MESSAGE = msg('This reset link is invalid or has expired.');
export const CONFIRM_LINK_INVALID_MESSAGE = msg('This confirmation link is invalid or has expired.');
export const FORGOT_PASSWORD_MESSAGE =
	msg("If an account exists for that email, we've sent a link to reset your password. It expires in 30 minutes.");
