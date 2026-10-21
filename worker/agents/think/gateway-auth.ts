/** Model coordinates as returned by `getConfigurationForModel`. */
export interface GatewayModelConfig {
	apiKey: string;
	defaultHeaders?: Record<string, string>;
}

export interface GatewayAuth {
	apiKey: string;
	headers?: Record<string, string>;
	/** True when the AI Gateway supplies the provider key (BYOK) and no `Authorization` header may be sent. */
	useStoredKeys: boolean;
}

/**
 * `getConfigurationForModel` only emits `cf-aig-authorization` when the platform
 * holds a provider key distinct from the gateway token. Without one, the
 * gateway's stored keys are used, so the request authenticates with the
 * gateway token alone.
 */
export function resolveGatewayAuth(conf: GatewayModelConfig, gatewayToken: string | undefined): GatewayAuth {
	const useStoredKeys = !conf.defaultHeaders?.['cf-aig-authorization'];
	const headers: Record<string, string> = { ...(conf.defaultHeaders ?? {}) };
	if (gatewayToken && !headers['cf-aig-authorization']) {
		headers['cf-aig-authorization'] = `Bearer ${gatewayToken}`;
	}
	return {
		apiKey: conf.apiKey,
		headers: Object.keys(headers).length > 0 ? headers : undefined,
		useStoredKeys,
	};
}

/** The settings that locate and authorize Estori's AI Gateway. */
export interface GatewayEnv {
	CLOUDFLARE_ACCOUNT_ID?: string;
	CLOUDFLARE_AI_GATEWAY?: string;
	CLOUDFLARE_AI_GATEWAY_TOKEN?: string;
	CLOUDFLARE_API_TOKEN?: string;
}

export interface ThinkGateway extends GatewayAuth {
	baseURL: string;
}

/**
 * Where and how a Think model is called through Estori's gateway. The gateway is addressed by account and gateway id
 * when both are set; `CLOUDFLARE_AI_GATEWAY_URL` is deliberately ignored then, since it may name a gateway the platform
 * token isn't authorized for. Otherwise the URL `getConfigurationForModel` resolved is used.
 */
export function resolveThinkGateway(conf: GatewayModelConfig & { baseURL: string }, env: GatewayEnv): ThinkGateway {
	const auth = resolveGatewayAuth(conf, env.CLOUDFLARE_AI_GATEWAY_TOKEN || env.CLOUDFLARE_API_TOKEN);
	const baseURL =
		env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_AI_GATEWAY
			? `https://gateway.ai.cloudflare.com/v1/${env.CLOUDFLARE_ACCOUNT_ID}/${env.CLOUDFLARE_AI_GATEWAY}/compat`
			: conf.baseURL;
	return { ...auth, baseURL };
}
