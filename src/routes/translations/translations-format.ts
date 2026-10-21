import { formatDistanceStrict } from 'date-fns';
import { LOCALE_NAMES, formatCredits, type Locale, type StoreLanguageStatus, type TaskStatus, type TaskView } from '@/api-types';
import { msg, t, tn } from '@/lib/i18n';
import { dateFnsLocale } from '@/lib/i18n/date-locale';

/** Where a language of a store stands, as its card's badge says. */
export const LANGUAGE_STATES = ['off', 'not-translated', 'translating', 'ready', 'paused', 'failed'] as const;
export type LanguageState = (typeof LANGUAGE_STATES)[number];

export type StatusVariant = 'secondary' | 'outline' | 'info' | 'success' | 'warning' | 'error';

/** English, marked for the catalogs; `t()` translates a label where it is shown. */
export const LANGUAGE_STATE_LABELS: Readonly<Record<LanguageState, string>> = {
	off: msg('Off'),
	'not-translated': msg('Not translated'),
	translating: msg('Translating'),
	ready: msg('Ready'),
	paused: msg('Paused'),
	failed: msg('Failed'),
};

export const LANGUAGE_STATE_VARIANTS: Readonly<Record<LanguageState, StatusVariant>> = {
	off: 'secondary',
	'not-translated': 'outline',
	translating: 'info',
	ready: 'success',
	paused: 'warning',
	failed: 'error',
};

const TASK_STATUS_LABELS: Readonly<Record<TaskStatus, string>> = {
	queued: msg('Queued'),
	running: msg('Running'),
	paused: msg('Paused'),
	done: msg('Done'),
	failed: msg('Failed'),
	canceled: msg('Canceled'),
};

const TASK_STATUS_VARIANTS: Readonly<Record<TaskStatus, StatusVariant>> = {
	queued: 'secondary',
	running: 'info',
	paused: 'warning',
	done: 'success',
	failed: 'error',
	canceled: 'outline',
};

/** Held until the daily allowance comes back tomorrow; it runs again then on its own. */
export function taskWaitsForAllowance(task: TaskView): boolean {
	return task.status === 'queued' && task.pauseReason === 'daily-limit';
}

/** The task takes a step soon, so the page reads it again: it runs, or waits its turn but not until tomorrow. */
export function taskIsMoving(task: TaskView): boolean {
	return task.status === 'running' || (task.status === 'queued' && !taskWaitsForAllowance(task));
}

/** Not finished: the seller can cancel it, and a new one for the same work would only find it again. */
export function taskIsUnfinished(task: TaskView): boolean {
	return task.status === 'queued' || task.status === 'running' || task.status === 'paused';
}

/** A task's own work comes first, since it says what is happening now; then whether the seller turned the language off. */
export function languageState(language: StoreLanguageStatus): LanguageState {
	const { task } = language;
	if (task && taskIsMoving(task)) return 'translating';
	if (task && (task.status === 'paused' || taskWaitsForAllowance(task))) return 'paused';
	if (!language.enabled) return 'off';
	if (task?.status === 'failed') return 'failed';
	return language.ready ? 'ready' : 'not-translated';
}

/** The whole percent translated, rounded down, so a language reads 100 only once every text is translated. */
export function translatedPercent(language: Pick<StoreLanguageStatus, 'total' | 'translated'>): number {
	return language.total === 0 ? 0 : Math.floor((language.translated * 100) / language.total);
}

/** The English badge of a task, marked for the catalogs; a task held for tomorrow's allowance reads as paused. */
export function taskBadge(task: TaskView): { label: string; variant: StatusVariant } {
	const status: TaskStatus = taskWaitsForAllowance(task) ? 'paused' : task.status;
	return { label: TASK_STATUS_LABELS[status], variant: TASK_STATUS_VARIANTS[status] };
}

/** What a task does, in the seller's language; a language is named in its own words. */
export function taskLabel(task: TaskView): string {
	switch (task.kind) {
		case 'store.translate':
			return t('Translate to {language}', { language: LOCALE_NAMES[task.payload.locale] });
	}
}

export function estimateText(credits: number, locale: Locale): string {
	return tn('About {credits} credit', 'About {credits} credits', credits, { credits: formatCredits(credits, locale) });
}

export function creditsLeftText(credits: number, locale: Locale): string {
	return tn('You have {credits} credit left.', 'You have {credits} credits left.', credits, { credits: formatCredits(credits, locale) });
}

export function creditsUsedText(credits: number, locale: Locale): string {
	return tn('{credits} credit used', '{credits} credits used', credits, { credits: formatCredits(credits, locale) });
}

/** How long ago a time was, the way the language says it: "3 minutes ago", "hace 3 minutos". */
function timeAgo(iso: string, locale: Locale, now: number): string {
	return formatDistanceStrict(new Date(iso), now, { addSuffix: true, locale: dateFnsLocale(locale) });
}

/** When the task last changed: when it ended, else when it started, else when it was added. */
export function taskTime(task: TaskView, locale: Locale, now: number = Date.now()): string {
	if (task.finishedAt) {
		const time = timeAgo(task.finishedAt, locale, now);
		if (task.status === 'failed') return t('Stopped {time}', { time });
		if (task.status === 'canceled') return t('Canceled {time}', { time });
		return t('Finished {time}', { time });
	}
	if (task.startedAt) return t('Started {time}', { time: timeAgo(task.startedAt, locale, now) });
	return t('Added {time}', { time: timeAgo(task.createdAt, locale, now) });
}

/** The store at `base` in `locale`; the store's own query parameters, such as a preview's token, are kept. */
export function previewHref(base: string, locale: Locale): string {
	const absolute = /^[a-z][a-z\d+.-]*:/i.test(base);
	const url = new URL(base, 'https://relative.invalid');
	url.searchParams.set('lang', locale);
	return absolute ? url.toString() : `${url.pathname}${url.search}${url.hash}`;
}
