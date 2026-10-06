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
