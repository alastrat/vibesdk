import { createLogger } from '../../logger';
import { isDev } from '../../utils/envs';
import { EMAIL_FROM, type EmailSender, type TransactionalEmailBinding } from './types';

const logger = createLogger('Email');

function cloudflareSender(binding: TransactionalEmailBinding): EmailSender {
	return {
		async send(email) {
			await binding.send({
				to: email.to,
				from: EMAIL_FROM,
				subject: email.subject,
				html: email.html,
				text: email.text,
			});
		},
	};
}

/** Writes the email to the dev server log so its link can be followed locally. */
const devLogSender: EmailSender = {
	async send(email) {
		logger.info('Email not sent (dev log)', { to: email.to, subject: email.subject, text: email.text });
	},
};

/** The Cloudflare binding when configured, the dev log in local development, otherwise null. */
export function createEmailSender(env: Env): EmailSender | null {
	if (env.EMAIL) {
		return cloudflareSender(env.EMAIL);
	}
	return isDev(env) ? devLogSender : null;
}

export function isEmailSendingEnabled(env: Env): boolean {
	return createEmailSender(env) !== null;
}
