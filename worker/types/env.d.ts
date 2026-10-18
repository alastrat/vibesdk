declare namespace Cloudflare {
	interface Env {
		// Dashboard-managed settings are intentionally omitted from wrangler vars.
		ALLOWED_EMAIL?: string;
		ALLOCATION_STRATEGY?: string;
		ENABLE_ARTIFACTS?: string;
		ENABLE_CLOUDFLARE_LIMITS?: string;
		ENABLE_EMAIL_AUTH?: string;
		ENABLE_READ_REPLICAS?: string;
		ENABLE_USER_ACCOUNT_DEPLOY?: string;
		USE_CLOUDFLARE_IMAGES?: string;
		USE_TUNNEL_FOR_PREVIEW?: string;

		// Secret bindings are omitted by `wrangler types` when absent from .dev.vars.
		AI_PROXY_JWT_SECRET: string;
		ANTHROPIC_API_KEY: string;
		CF_ACCESS_ID: string;
		CF_ACCESS_SECRET: string;
		CLOUDFLARE_AI_GATEWAY_URL: string;
		CUSTOM_PREVIEW_DOMAIN: string;
		GOOGLE_AI_STUDIO_API_KEY: string;
		GOOGLE_CLIENT_ID: string;
		GOOGLE_CLIENT_SECRET: string;
		GITHUB_CLIENT_ID: string;
		GITHUB_CLIENT_SECRET: string;
		OPENROUTER_API_KEY: string;
		PLATFORM_MODEL_PROVIDERS: string;
		SANDBOX_SERVICE_API_KEY: string;
		SANDBOX_SERVICE_TYPE: string;
		SANDBOX_SERVICE_URL: string;
		SENTRY_DSN: string;
		SERPAPI_KEY: string;

		// "true" lets a failed build model's notice offer switching to the fallback model.
		ENABLE_THINK_MODEL_FALLBACK?: string;
		// The shared shopper email address, on a domain onboarded to Email Service; each store sends from its slug on the same
		// domain. Unset, every store sends from Estori's no-reply address.
		SHOPPER_EMAIL_FROM?: string;
		// The catalog supplier's API key; without it catalog prices read as unavailable.
		CJDROPSHIPPING_API_KEY?: string;
		// Live supplier orders need ENVIRONMENT prod and this set to "true"; anything else places sandbox orders.
		CATALOG_SUPPLIER_LIVE?: string;
		// Live stores: the domain store subdomains sit under (its own registrable domain, on the Public Suffix List).
		// Live stores are off when it's unset.
		STORES_DOMAIN?: string;
		// The name sellers point their custom domain's CNAME at, on the stores zone.
		STORES_CNAME_TARGET?: string;
		// The Cloudflare for SaaS zone that holds sellers' custom hostnames, and a token that can edit them.
		CF_SAAS_ZONE_ID?: string;
		CF_SAAS_API_TOKEN?: string;
		// "on" lets live stores take real payments when the Stripe key is live; test keys need nothing.
		LIVE_STORE_PAYMENTS?: string;
		// Stripe's publishable key for Stripe.js on Estori's store checkout page; public by design.
		STRIPE_PUBLISHABLE_KEY?: string;
		// Signing secret of the Connect webhook endpoint: events on sellers' accounts, such as payout.paid.
		STRIPE_CONNECT_WEBHOOK_SECRET?: string;
		CATALOG_ORDER_RUNNER: DurableObjectNamespace<import('../services/catalog/CatalogOrderRunner').CatalogOrderRunner>;
	}
}
