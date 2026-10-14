export interface OutgoingEmail {
	to: string;
	subject: string;
	html: string;
	text: string;
}

export interface EmailSender {
	send(email: OutgoingEmail): Promise<void>;
}

/** A named address, the Email Service's form for a sender with a display name. */
export interface EmailAddress {
	email: string;
	name: string;
}

/** The Cloudflare Email Service binding (send_email with remote: true). */
export interface TransactionalEmailBinding {
	send(message: { to: string; from: string | EmailAddress; subject: string; html: string; text: string }): Promise<{ messageId: string }>;
}

export const EMAIL_FROM: EmailAddress = { email: 'no-reply@estori.app', name: 'Estori' };
