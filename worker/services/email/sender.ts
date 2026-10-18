import { createLogger } from '../../logger';
import { isDev } from '../../utils/envs';
import { EMAIL_FROM, type EmailSender, type TransactionalEmailBinding } from './types';

const logger = createLogger('Email');

function cloudflareSender(binding: TransactionalEmailBinding): EmailSender {
	return {
		async send(email) {
			const from = email.fromEmail || email.fromName ? { email: email.fromEmail ?? EMAIL_FROM.email, name: email.fromName ?? EMAIL_FROM.name } : EMAIL_FROM;
			return binding.send({
				to: email.to,
				from,
				subject: email.subject,
				html: email.html,
				text: email.text,
				...(email.replyTo ? { replyTo: email.replyTo } : {}),
				...(email.headers ? { headers: email.headers } : {}),
			});
		},
	};
}

/** Writes the email to the dev server log so its link can be followed locally. */
const devLogSender: EmailSender = {
	async send(email) {
		logger.info('Email not sent (dev log)', { to: email.to, fromName: email.fromName, replyTo: email.replyTo, subject: email.subject, text: email.text });
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
