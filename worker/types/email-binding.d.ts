declare namespace Cloudflare {
	interface Env {
		// Absent until the domain is onboarded in Cloudflare Email Service.
		EMAIL?: import('../services/email/types').TransactionalEmailBinding;
		// Where contact-sales requests are announced; set it to start sending those notices.
		SALES_INBOX?: string;
	}
}
