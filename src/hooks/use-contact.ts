import { useMutation, useQuery } from '@tanstack/react-query';
import { CONTACT_FAILED_MESSAGE, type ContactRequestBody } from '@/api-types';
import { apiClient } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { unwrap } from '@/lib/unwrap-response';

export function useSubmitContact() {
	return useMutation({
		mutationFn: (body: ContactRequestBody) => unwrap(apiClient.submitContact(body), CONTACT_FAILED_MESSAGE),
	});
}

export function useAdminContactRequests() {
	return useQuery({
		queryKey: queryKeys.account.contactRequests.admin(),
		queryFn: () => unwrap(apiClient.getAdminContactRequests(), "Couldn't load the contact requests"),
		retry: false,
	});
}
