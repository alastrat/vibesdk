import { useEffect } from 'react';
import { msg, t } from '@/lib/i18n';
import { useLocation, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { EarlyAccessCapability } from '@/api-types';
import { useAuth } from '@/contexts/auth-context';
import { apiClient } from '@/lib/api-client';
import { requestedCapability } from '@/lib/early-access';
import { queryKeys } from '@/lib/query-keys';
import { unwrap } from '@/lib/unwrap-response';

export const EARLY_ACCESS_CONFIRMATION = msg("You're on the list. We'll email you when it opens.");

export function useMyEarlyAccess() {
	const { user, isAuthenticated } = useAuth();
	return useQuery({
		queryKey: queryKeys.account.earlyAccess.mine(user?.id),
		queryFn: () => unwrap(apiClient.getMyEarlyAccess(), "Couldn't load your early access requests"),
		enabled: isAuthenticated,
		retry: false,
	});
}

export function useRequestEarlyAccess() {
	const queryClient = useQueryClient();
	const { user } = useAuth();
	return useMutation({
		mutationFn: (capability: EarlyAccessCapability) => unwrap(apiClient.requestEarlyAccess(capability), "Couldn't save your request"),
		onSuccess: (data) => queryClient.setQueryData(queryKeys.account.earlyAccess.mine(user?.id), data),
	});
}

export function useAdminEarlyAccess() {
	return useQuery({
		queryKey: queryKeys.account.earlyAccess.admin(),
		queryFn: () => unwrap(apiClient.getAdminEarlyAccess(), "Couldn't load early access requests"),
		retry: false,
	});
}

/** Records a request that a sign-in carried back in the URL, then takes it out of the URL. */
export function useEarlyAccessFromUrl(): void {
	const { isAuthenticated } = useAuth();
	const { pathname, search, hash } = useLocation();
	const navigate = useNavigate();
	const { mutate } = useRequestEarlyAccess();
	const capability = requestedCapability(search);

	useEffect(() => {
		if (!isAuthenticated || !capability) return;
		mutate(capability, {
			onSuccess: () => toast.success(t(EARLY_ACCESS_CONFIRMATION)),
			onError: (error) => toast.error(t(error.message)),
		});
		navigate({ pathname, hash }, { replace: true });
	}, [isAuthenticated, capability, mutate, navigate, pathname, hash]);
}
