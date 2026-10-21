import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Locale, StoreTranslationOverview, StoreTranslationSettingsPatch, TaskView } from '@/api-types';
import { apiClient } from '@/lib/api-client';
import { t } from '@/lib/i18n';
import { queryKeys } from '@/lib/query-keys';
import { unwrap } from '@/lib/unwrap-response';
import { taskIsMoving } from '@/routes/translations/translations-format';

/** How often the page reads a store again while one of its tasks moves. */
export const TASK_POLL_MS = 3_000;

/** The seller's stores that have been deployed, for the picker. Nothing is read while `enabled` is false. */
export function useTranslationStores(enabled: boolean) {
	return useQuery({
		queryKey: queryKeys.account.storeTranslations.stores(),
		queryFn: () => unwrap(apiClient.getTranslationStores(), t("Couldn't load your stores")),
		enabled,
		retry: false,
	});
}

/**
 * A store's settings and languages. Reading them can make the server read the store's deployments again, so they are not
 * polled: `useStoreTasks` reads them again when a task's status changes.
 */
export function useStoreTranslations(appId: string) {
	return useQuery({
		queryKey: queryKeys.account.storeTranslations.store(appId),
		queryFn: () => unwrap(apiClient.getStoreTranslations(appId), t("Couldn't load this store's translations")),
		retry: false,
	});
}

/** Each task's status and why it waits, which the store's languages show; progress alone leaves them as they are. */
function statusesOf(tasks: readonly TaskView[]): string {
	return tasks.map((task) => `${task.id}:${task.status}:${task.pauseReason ?? ''}`).join(',');
}

/**
 * The store's tasks, newest first, read again every few seconds while one of them moves. When a task's status changes,
 * such as from running to done, the store's languages are read again once.
 */
export function useStoreTasks(appId: string) {
	const queryClient = useQueryClient();
	const tasks = useQuery({
		queryKey: queryKeys.account.tasks.store(appId),
		queryFn: () => unwrap(apiClient.getTasks(appId), t("Couldn't load this store's activity")),
		retry: false,
		refetchInterval: (query) => (query.state.data?.some(taskIsMoving) ? TASK_POLL_MS : false),
	});
	const statuses = tasks.data ? statusesOf(tasks.data) : null;
	const seen = useRef<string | null>(null);
	useEffect(() => {
		if (statuses === null) return;
		if (seen.current !== null && seen.current !== statuses) void queryClient.invalidateQueries({ queryKey: queryKeys.account.storeTranslations.store(appId) });
		seen.current = statuses;
	}, [appId, queryClient, statuses]);
	return tasks;
}

/** Reads the store's tasks again after a change to one; a changed status then reads the store's languages (`useStoreTasks`). */
function useTasksRefresh(appId: string) {
	const queryClient = useQueryClient();
	return () => queryClient.invalidateQueries({ queryKey: queryKeys.account.tasks.store(appId) });
}

export function useSaveTranslationSettings(appId: string) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (patch: StoreTranslationSettingsPatch) => unwrap(apiClient.saveStoreTranslationSettings(appId, patch), t("Couldn't save your settings")),
		onSuccess: (settings, patch) => {
			queryClient.setQueryData<StoreTranslationOverview>(queryKeys.account.storeTranslations.store(appId), (data) =>
				data ? { ...data, settings, languages: data.languages.map((language) => ({ ...language, enabled: settings.targets[language.locale]?.enabled ?? false })) } : data,
			);
			// The picker lists each store's languages; a new store language changes which languages the store has.
			void queryClient.invalidateQueries({ queryKey: queryKeys.account.storeTranslations.stores() });
			if (patch.sourceLocale !== undefined) void queryClient.invalidateQueries({ queryKey: queryKeys.account.storeTranslations.store(appId) });
		},
	});
}

/** Starts translating the store into a language, or finds the translation already under way. */
export function useRunStoreTranslation(appId: string) {
	const queryClient = useQueryClient();
	const refresh = useTasksRefresh(appId);
	return useMutation({
		mutationFn: (locale: Locale) => unwrap(apiClient.runStoreTranslation(appId, locale), t("Couldn't start the translation")),
		onSuccess: (result) => {
			void refresh();
			// No new task, so no new status to notice: the language may still have been turned on.
			if (!result.created) void queryClient.invalidateQueries({ queryKey: queryKeys.account.storeTranslations.store(appId) });
		},
	});
}

export function useCancelTask(appId: string) {
	const refresh = useTasksRefresh(appId);
	return useMutation({
		mutationFn: (taskId: string) => unwrap(apiClient.cancelTask(taskId), t("Couldn't cancel it")),
		onSuccess: refresh,
	});
}

/** Resume for a paused task, Retry for a failed one: either goes on where it stopped. */
export function useResumeTask(appId: string) {
	const refresh = useTasksRefresh(appId);
	return useMutation({
		mutationFn: (taskId: string) => unwrap(apiClient.resumeTask(taskId), t("Couldn't resume it")),
		onSuccess: refresh,
	});
}
