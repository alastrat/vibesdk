import type { ClientFlagKey } from '@/api-types';
import { useAuth } from '@/contexts/auth-context';

/** A client-visible flag for the signed-in user, sent with the session; off when signed out, like every flag's default. */
export function useFlag(key: ClientFlagKey): boolean {
	const { telemetry } = useAuth();
	return telemetry?.flags[key] ?? false;
}
