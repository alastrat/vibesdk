declare namespace Cloudflare {
	interface Env {
		// Absent until the domain is onboarded in Cloudflare Email Service.
		EMAIL?: import('../services/email/types').TransactionalEmailBinding;
	}
}
