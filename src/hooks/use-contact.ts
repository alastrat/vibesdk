import { useMutation, useQuery } from '@tanstack/react-query';
import type { ContactRequestBody } from '@/api-types';
import { apiClient } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { unwrap } from '@/lib/unwrap-response';

export function useSubmitContact() {
	return useMutation({
		mutationFn: (body: ContactRequestBody) => unwrap(apiClient.submitContact(body), "Couldn't send your message. Please try again."),
	});
}

export function useAdminContactRequests() {
	return useQuery({
		queryKey: queryKeys.account.contactRequests.admin(),
		queryFn: () => unwrap(apiClient.getAdminContactRequests(), "Couldn't load the contact requests"),
		retry: false,
	});
}
