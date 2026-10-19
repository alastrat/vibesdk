import { createLogger } from '../../logger';
import { isDev } from '../../utils/envs';
import { blockedRecipientError, recipientAllowlist } from './recipient-allowlist';
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

/** Sends only to recipients `allows` lets through; the rest are logged and fail with BLOCKED_RECIPIENT_CODE. */
function allowlisted(sender: EmailSender, allows: (recipient: string) => boolean): EmailSender {
	return {
		async send(email) {
			if (!allows(email.to)) {
				logger.info('Email not sent: not on the allowlist', { to: email.to, subject: email.subject });
				throw blockedRecipientError();
			}
			return sender.send(email);
		},
	};
}

/** The Cloudflare binding when configured, the dev log in local development, otherwise null; limited to EMAIL_RECIPIENT_ALLOWLIST when set. */
export function createEmailSender(env: Env): EmailSender | null {
	const sender = env.EMAIL ? cloudflareSender(env.EMAIL) : isDev(env) ? devLogSender : null;
	const allows = recipientAllowlist(env.EMAIL_RECIPIENT_ALLOWLIST);
	return sender && allows ? allowlisted(sender, allows) : sender;
}

export function isEmailSendingEnabled(env: Env): boolean {
	return createEmailSender(env) !== null;
}
