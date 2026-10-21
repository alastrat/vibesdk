import type { Locale } from '../i18n/locales';
import type { TaskView } from './tasks';

/** Where a store text came from: page markup, scripts and server modules, or the product manifest. */
export const STORE_TEXT_KINDS = ['page', 'script', 'product'] as const;
export type StoreTextKind = (typeof STORE_TEXT_KINDS)[number];

/** A text longer than this is not translated. */
export const MAX_TEXT_CHARS = 5_000;

/** A store yields at most this many distinct texts; past it the extraction reports that it stopped. */
export const MAX_STORE_TEXTS = 5_000;

/** An entry of THINK_MODELS, so every call is priced from its real token usage. */
export const TASK_MODEL_ID = 'google-ai-studio/gemini-3.6-flash';

/** A task's step translates one batch: at most this many texts or characters. */
export const TRANSLATION_BATCH_MAX_TEXTS = 40;
export const TRANSLATION_BATCH_MAX_CHARS = 12_000;

/** A text a store shows shoppers, keyed by the hash of its normalized form. */
export interface StoreText {
	hash: string;
	text: string;
	kind: StoreTextKind;
}

/** Who wrote a translation: the machine, or the seller, whose edit no task overwrites. */
export const STORE_TRANSLATION_ORIGINS = ['machine', 'seller'] as const;
export type StoreTranslationOrigin = (typeof STORE_TRANSLATION_ORIGINS)[number];

/**
 * The `version` of settings nothing has changed: a store with no settings row reads as this, and a row made only by
 * reading the store's texts starts here. Saving settings, finishing a translation and editing one all raise it.
 */
export const UNTOUCHED_SETTINGS_VERSION = 1;

/** A store's language settings. `version` goes up whenever the settings or what shoppers would see change. */
export interface StoreTranslationSettings {
	sourceLocale: Locale;
	/** Each language the seller has turned on or off, and whether its first translation finished. */
	targets: Partial<Record<Locale, { enabled: boolean; ready: boolean }>>;
	matchBrowser: boolean;
	showSwitcher: boolean;
	autoTranslate: boolean;
	version: number;
	/** Last source-text extraction; invalidates serving caches without marking settings as seller-confirmed. */
	extractedAt?: number | null;
}

/** The seller's changes to the settings; what a change leaves out stays. `ready` is only set by finishing a translation. */
export interface StoreTranslationSettingsPatch {
	sourceLocale?: Locale;
	targets?: Partial<Record<Locale, { enabled: boolean }>>;
	matchBrowser?: boolean;
	showSwitcher?: boolean;
	autoTranslate?: boolean;
}

/** One current text of a store with its translation into a language; `text` and `origin` are null until it is translated. */
export interface StoreTranslationRow {
	hash: string;
	source: string;
	text: string | null;
	origin: StoreTranslationOrigin | null;
	/** What the machine wrote, which the seller can go back to; null when the machine never translated it. */
	machineText: string | null;
}

/** A page of a language's texts; `nextCursor` is null on the last page. */
export interface StoreTranslationPage {
	rows: StoreTranslationRow[];
	nextCursor: string | null;
}

/** How far a language is, against the store's current texts. */
export interface StoreTranslationCounts {
	total: number;
	translated: number;
	/** Translated texts the seller wrote or changed. */
	edited: number;
}

/** A machine translation to store: the text it translates, and what it came to. */
export interface MachineTranslation {
	hash: string;
	source: string;
	text: string;
}

/** What the last read of a store's deployments noticed besides its texts. */
export interface StoreExtractionNotes {
	/** The read stopped at `MAX_STORE_TEXTS`. */
	truncated: boolean;
	/** The store's product file couldn't be understood, so its products weren't read. */
	manifestInvalid: boolean;
}

/** The seller's own words for a text. */
export interface StoreTranslationTextRequest {
	text: string;
}

/** A page of the translations editor lists this many texts. */
export const STORE_TRANSLATION_PAGE_SIZE = 50;

/** The Translations page in the main menu. */
export const STORE_TRANSLATIONS_PATH = '/translations';

/** A language the store can be translated into, and how far it is; `left` is the texts with no translation yet. */
export interface StoreLanguageStatus {
	locale: Locale;
	enabled: boolean;
	ready: boolean;
	total: number;
	translated: number;
	edited: number;
	left: number;
	/** About how many AI credits translating what's left costs. */
	estimateCredits: number;
	/** The language's latest translation task, in any status; null when none was ever started. */
	task: TaskView | null;
}

/** GET /api/stores/:id/translations: a store's settings, one status per language it isn't written in, and where to see it. */
export interface StoreTranslationOverview {
	settings: StoreTranslationSettings;
	languages: StoreLanguageStatus[];
	/** When the store's text was last read from its deployments, as an ISO time; null before the first read. */
	extractedAt: string | null;
	/** The last read stopped at the store's text limit. */
	truncated: boolean;
	/** The last read couldn't understand the store's product file, so its products weren't read. */
	manifestInvalid: boolean;
	/** The store has been deployed. False means there's nothing to translate yet. */
	deployed: boolean;
	/** The store's deployments couldn't be read just now; the texts and counts are as they were last read. */
	textsUnavailable: boolean;
	/** AI credits the seller has left; null while billing is off. */
	creditsLeft: number | null;
	/** The store's preview, in its own language or, with `?lang=`, a language that is on and ready; null before it has one. */
	previewUrl: string | null;
	/** The live store's address; null while it isn't live. */
	liveUrl: string | null;
}

/** A store in the Translations page's picker, with where each of its other languages stands. */
export interface StoreTranslationStoreSummary {
	appId: string;
	title: string;
	sourceLocale: Locale;
	languages: Array<{ locale: Locale; enabled: boolean; ready: boolean }>;
}

/** POST /api/stores/:id/translations/:locale/run: the language's task, which `created` says this call queued. */
export interface StoreTranslationRun {
	task: TaskView;
	created: boolean;
}
