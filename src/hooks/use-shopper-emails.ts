import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ShopperEmailKind, ShopperEmailsData, ShopperEmailTemplate, ShopperEmailTemplateFields, ShopperEmailTemplateView } from '@/api-types';
import { apiClient } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { unwrap } from '@/lib/unwrap-response';

export function useShopperEmailStores() {
	return useQuery({
		queryKey: queryKeys.account.shopperEmails.stores(),
		queryFn: () => unwrap(apiClient.getShopperEmailStores(), "Couldn't load your stores"),
		retry: false,
	});
}

export function useShopperEmails(appId: string | null) {
	return useQuery({
		queryKey: queryKeys.account.shopperEmails.store(appId ?? ''),
		queryFn: () => unwrap(apiClient.getShopperEmails(appId ?? ''), "Couldn't load this store's emails"),
		enabled: appId !== null,
		retry: false,
	});
}

/** Puts a saved or reset template in the store's data, then reads it again for the recent list. */
function useTemplateUpdate(appId: string) {
	const queryClient = useQueryClient();
	return (template: ShopperEmailTemplateView) => {
		queryClient.setQueryData<ShopperEmailsData>(queryKeys.account.shopperEmails.store(appId), (data) =>
			data ? { ...data, templates: data.templates.map((current) => (current.kind === template.kind ? template : current)) } : data,
		);
		void queryClient.invalidateQueries({ queryKey: queryKeys.account.shopperEmails.store(appId) });
	};
}

export function useSaveShopperEmail(appId: string) {
	const update = useTemplateUpdate(appId);
	return useMutation({
		mutationFn: (input: { kind: ShopperEmailKind; template: ShopperEmailTemplate }) => unwrap(apiClient.saveShopperEmail(appId, input.kind, input.template), "Couldn't save the email"),
		onSuccess: update,
	});
}

export function useResetShopperEmail(appId: string) {
	const update = useTemplateUpdate(appId);
	return useMutation({
		mutationFn: (kind: ShopperEmailKind) => unwrap(apiClient.resetShopperEmail(appId, kind), "Couldn't reset the email"),
		onSuccess: update,
	});
}

export function useSaveShopperEmailSettings(appId: string) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (replyTo: string | null) => unwrap(apiClient.saveShopperEmailSettings(appId, { replyTo }), "Couldn't save where replies go"),
		onSuccess: (settings) => {
			queryClient.setQueryData<ShopperEmailsData>(queryKeys.account.shopperEmails.store(appId), (data) => (data ? { ...data, replyTo: settings.replyTo } : data));
		},
	});
}

/** The email as shoppers would get it, filled in with a sample order; it keeps the last preview while the next loads. */
export function useShopperEmailPreview(appId: string, kind: ShopperEmailKind, fields: ShopperEmailTemplateFields) {
	return useQuery({
		queryKey: queryKeys.account.shopperEmails.preview(appId, kind, fields.subject, fields.heading, fields.body),
		queryFn: () => unwrap(apiClient.previewShopperEmail(appId, kind, fields), "Couldn't preview the email"),
		placeholderData: keepPreviousData,
		retry: false,
	});
}

export function useSendShopperEmailTest(appId: string) {
	return useMutation({
		mutationFn: (input: { kind: ShopperEmailKind; fields: ShopperEmailTemplateFields }) => unwrap(apiClient.sendShopperEmailTest(appId, input.kind, input.fields), "Couldn't send the test"),
	});
}
