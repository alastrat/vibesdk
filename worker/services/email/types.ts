export interface OutgoingEmail {
	to: string;
	subject: string;
	html: string;
	text: string;
	/** An onboarded sending address other than Estori's default, such as one for store emails. */
	fromEmail?: string;
	/** The name shoppers see, such as the store's name; Estori's by default. */
	fromName?: string;
	replyTo?: string;
	/** Custom `X-` headers. */
	headers?: Record<string, string>;
}

export interface SentEmail {
	messageId: string;
}

export interface EmailSender {
	/** The Email Service's message id when it sends; the dev log answers nothing. */
	send(email: OutgoingEmail): Promise<SentEmail | void>;
}

/** A named address, the Email Service's form for a sender with a display name. */
export interface EmailAddress {
	email: string;
	name: string;
}

/** The Cloudflare Email Service binding (send_email with remote: true). */
export interface TransactionalEmailBinding {
	send(message: { to: string; from: string | EmailAddress; subject: string; html: string; text: string; replyTo?: string; headers?: Record<string, string> }): Promise<{ messageId: string }>;
}

export const EMAIL_FROM: EmailAddress = { email: 'no-reply@estori.app', name: 'Estori' };
