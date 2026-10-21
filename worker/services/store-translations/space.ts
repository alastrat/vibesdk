/** A store's SpaceDO, which holds its deployments. The binding is absent in some environments, so callers check it first. */

function namespaceOf(env: Env): DurableObjectNamespace | undefined {
	return (env as unknown as { SPACE_DO?: DurableObjectNamespace }).SPACE_DO;
}

export function hasSpaceBinding(env: Env): boolean {
	return namespaceOf(env) !== undefined;
}

/** A fresh stub of the store's SpaceDO, typed as the RPC methods the caller uses. Throws without the binding. */
export function spaceStubOf<Stub>(env: Env, appId: string): Stub {
	const namespace = namespaceOf(env);
	if (!namespace) throw new Error('SPACE_DO binding is not configured');
	return namespace.get(namespace.idFromName(appId)) as unknown as Stub;
}
