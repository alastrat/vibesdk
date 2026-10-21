import { useEffect, useRef } from 'react';
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query';
import { MAX_TEXT_CHARS, type Locale, type StoreTranslationOverview, type StoreTranslationPage, type StoreTranslationRow, type StoreTranslationSettingsPatch, type TaskView } from '@/api-types';
import { ApiError, apiClient } from '@/lib/api-client';
import { getLocale, t } from '@/lib/i18n';
import { queryKeys } from '@/lib/query-keys';
import { unwrap } from '@/lib/unwrap-response';
import { languagesDisagreeWithTasks, taskRefetchDelay } from '@/routes/translations/translations-format';
import { formatNumber } from '../../shared/i18n/format';

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
 * The store's tasks, newest first: read again every few seconds while one moves, and once when a waiting one is due. The
 * store's languages are read again once when a task's status changes, such as from running to done, and once when the
 * first read of each disagrees about a language's task. A status change also reads the editor's texts again, which a
 * translation fills in.
 */
export function useStoreTasks(appId: string) {
	const queryClient = useQueryClient();
	const tasks = useQuery({
		queryKey: queryKeys.account.tasks.store(appId),
		queryFn: () => unwrap(apiClient.getTasks(appId), t("Couldn't load this store's activity")),
		retry: false,
		refetchInterval: (query) => (query.state.data ? taskRefetchDelay(query.state.data) : false),
	});
	const statuses = tasks.data ? statusesOf(tasks.data) : null;
	const seen = useRef<string | null>(null);
	const reconciled = useRef(false);
	useEffect(() => {
		if (statuses === null || !tasks.data) return;
		const changed = seen.current !== null && seen.current !== statuses;
		seen.current = statuses;
		const overview = queryClient.getQueryData<StoreTranslationOverview>(queryKeys.account.storeTranslations.store(appId));
		const stale = !reconciled.current && overview !== undefined && languagesDisagreeWithTasks(overview.languages, tasks.data);
		if (overview !== undefined) reconciled.current = true;
		if (changed || stale) void queryClient.invalidateQueries({ queryKey: queryKeys.account.storeTranslations.store(appId) });
		if (changed) void queryClient.invalidateQueries({ queryKey: queryKeys.account.storeTranslations.textsOf(appId) });
	}, [appId, queryClient, statuses, tasks.data]);
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
		onSuccess: (settings) => {
			const key = queryKeys.account.storeTranslations.store(appId);
			const before = queryClient.getQueryData<StoreTranslationOverview>(key)?.settings.sourceLocale;
			queryClient.setQueryData<StoreTranslationOverview>(key, (data) =>
				data ? { ...data, settings, languages: data.languages.map((language) => ({ ...language, enabled: settings.targets[language.locale]?.enabled ?? false })) } : data,
			);
			// The picker lists each store's languages; a new store language changes which languages the store has.
			void queryClient.invalidateQueries({ queryKey: queryKeys.account.storeTranslations.stores() });
			if (before !== settings.sourceLocale) void queryClient.invalidateQueries({ queryKey: key });
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

type TextPages = InfiniteData<StoreTranslationPage, string | null>;

/** A language's texts for a search, a page at a time. The list stays on screen while the next search loads. */
export function useTranslationTexts(appId: string, locale: Locale, query: string) {
	return useInfiniteQuery({
		queryKey: queryKeys.account.storeTranslations.texts(appId, locale, query),
		queryFn: ({ pageParam }) => unwrap(apiClient.getStoreTranslationTexts(appId, locale, { query: query || undefined, cursor: pageParam ?? undefined }), t("Couldn't load your store's text")),
		initialPageParam: null as string | null,
		getNextPageParam: (page) => page.nextCursor,
		placeholderData: keepPreviousData,
		retry: false,
	});
}

/**
 * A saved or reverted text, put where it stands in every list of its language so the list doesn't move, and the store's
 * languages read again, since their counts of edits and translated texts changed.
 */
function textChanged(queryClient: QueryClient, appId: string, locale: Locale, row: StoreTranslationRow): void {
	queryClient.setQueriesData<TextPages>({ queryKey: queryKeys.account.storeTranslations.languageTexts(appId, locale) }, (data) =>
		data && { ...data, pages: data.pages.map((page) => ({ ...page, rows: page.rows.map((current) => (current.hash === row.hash ? row : current)) })) },
	);
	void queryClient.invalidateQueries({ queryKey: queryKeys.account.storeTranslations.store(appId) });
}

/** Saves the seller's own words for a text. A 400 is a text that is empty or too long, which the message says. */
export function useSaveTranslationText(appId: string, locale: Locale) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async ({ hash, text }: { hash: string; text: string }) => {
			try {
				return await unwrap(apiClient.saveStoreTranslationText(appId, locale, hash, text), t("Couldn't save this translation"));
			} catch (error) {
				if (error instanceof ApiError && error.status === 400) throw new Error(t('Write the translation, up to {max} characters.', { max: formatNumber(MAX_TEXT_CHARS, getLocale()) }));
				throw error;
			}
		},
		onSuccess: (row) => textChanged(queryClient, appId, locale, row),
	});
}

/** Gives a text back the automatic translation. */
export function useRevertTranslationText(appId: string, locale: Locale) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (hash: string) => unwrap(apiClient.revertStoreTranslationText(appId, locale, hash), t("Couldn't go back to the automatic translation")),
		onSuccess: (row) => textChanged(queryClient, appId, locale, row),
	});
}
