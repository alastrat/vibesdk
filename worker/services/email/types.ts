export interface OutgoingEmail {
	to: string;
	subject: string;
	html: string;
	text: string;
}

export interface EmailSender {
	send(email: OutgoingEmail): Promise<void>;
}

/** The Cloudflare Email Service binding (send_email with remote: true). */
export interface TransactionalEmailBinding {
	send(message: { to: string; from: string; subject: string; html: string; text: string }): Promise<{ messageId: string }>;
}

export const EMAIL_FROM = 'Estori <no-reply@estori.app>';
