/**
 * D1 for a store's translations: the texts it shows shoppers, each language's translations (the machine's, and the
 * seller's own edits) and the language settings. `version` on the settings goes up with every write that changes what
 * shoppers would see, so caches and the overlay script key on it. Times are epoch milliseconds.
 */

import { and, asc, count, eq, isNotNull, notExists, or, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import * as schema from '../schema';
import { BaseService } from './BaseService';
import { LocalePreferenceService } from './LocalePreferenceService';
import { DEFAULT_LOCALE, LOCALES, type Locale } from '../../../shared/i18n/locales';
import type {
	MachineTranslation,
	StoreText,
	StoreTranslationCounts,
	StoreTranslationPage,
	StoreTranslationRow,
	StoreTranslationSettings,
	StoreTranslationSettingsPatch,
} from '../../../shared/types/store-translations';

/** D1 binds at most 100 parameters per statement, so a bulk insert goes in chunks of whole rows under it. */
const D1_MAX_PARAMETERS = 100;
const TEXT_COLUMNS = 5;
const TRANSLATION_COLUMNS = 8;
const MAX_LIST_ROWS = 200;
const MAX_QUERY_CHARS = 200;

const DEFAULT_SETTINGS = { matchBrowser: true, showSwitcher: true, autoTranslate: true, version: 1 } as const;

type SettingsRow = typeof schema.storeTranslationSettings.$inferSelect;
type Targets = StoreTranslationSettings['targets'];

function chunked<T>(items: readonly T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let start = 0; start < items.length; start += size) chunks.push(items.slice(start, start + size));
	return chunks;
}

/** The stored flags of each language Estori speaks; anything else in the JSON is dropped. */
function targetsOf(value: unknown): Targets {
	const targets: Targets = {};
	if (typeof value !== 'object' || value === null) return targets;
	for (const locale of LOCALES) {
		const entry: unknown = (value as Record<string, unknown>)[locale];
		if (typeof entry !== 'object' || entry === null) continue;
		const { enabled, ready } = entry as Record<string, unknown>;
		targets[locale] = { enabled: enabled === true, ready: ready === true };
	}
	return targets;
}

function settingsFromRow(row: SettingsRow): StoreTranslationSettings {
	return {
		sourceLocale: row.sourceLocale,
		targets: targetsOf(row.targets),
		matchBrowser: row.matchBrowser,
		showSwitcher: row.showSwitcher,
		autoTranslate: row.autoTranslate,
		version: row.version,
	};
}

/** A list page ends at its last row's read time and rowid, so rows read at the same time are neither skipped nor repeated. */
const CURSOR = /^(\d{1,16}):(\d{1,16})$/;

export class StoreTranslationService extends BaseService {
	/** The store's settings; the defaults, with the owner's language as the source, when it has none yet. */
	async settingsOf(appId: string): Promise<StoreTranslationSettings> {
		const row = await this.database.select().from(schema.storeTranslationSettings).where(eq(schema.storeTranslationSettings.appId, appId)).get();
		if (row) return settingsFromRow(row);
		return { sourceLocale: await this.defaultSourceLocale(appId), targets: {}, ...DEFAULT_SETTINGS };
	}

	/** When the store's texts were last read from its deployments; null before the first time. */
	async extractedAt(appId: string): Promise<number | null> {
		const settings = schema.storeTranslationSettings;
		const row = await this.database.select({ extractedAt: settings.extractedAt }).from(settings).where(eq(settings.appId, appId)).get();
		return row?.extractedAt ?? null;
	}

	/** Applies the seller's changes and returns the settings. A language the patch names keeps its `ready` flag. */
	async saveSettings(appId: string, patch: StoreTranslationSettingsPatch, now: number = Date.now()): Promise<StoreTranslationSettings> {
		const settings = schema.storeTranslationSettings;
		const named = patch.targets === undefined ? {} : patch.targets;
		await this.batchWithSettings(
			appId,
			now,
			this.database
				.update(settings)
				.set({
					sourceLocale: patch.sourceLocale,
					matchBrowser: patch.matchBrowser,
					showSwitcher: patch.showSwitcher,
					autoTranslate: patch.autoTranslate,
					// A JSON merge patch changes only the languages and flags it names.
					targets: Object.keys(named).length > 0 ? sql`json_patch(${settings.targets}, ${JSON.stringify(named)})` : undefined,
					version: sql`${settings.version} + 1`,
					updatedAt: now,
				})
				.where(eq(settings.appId, appId)),
		);
		return this.settingsOf(appId);
	}

	/**
	 * A language's first translation finished, so shoppers can be served it. A language the seller never set is turned on,
	 * since they asked for it by translating it; one they turned off stays off.
	 */
	async markReady(appId: string, locale: Locale, now: number = Date.now()): Promise<StoreTranslationSettings> {
		const settings = schema.storeTranslationSettings;
		const turnedOn = JSON.stringify({ [locale]: { enabled: true } });
		const ready = JSON.stringify({ [locale]: { ready: true } });
		await this.batchWithSettings(
			appId,
			now,
			this.database
				.update(settings)
				.set({ targets: sql`json_patch(${turnedOn}, json_patch(${settings.targets}, ${ready}))`, version: sql`${settings.version} + 1`, updatedAt: now })
				.where(eq(settings.appId, appId)),
		);
		return this.settingsOf(appId);
	}

	/**
	 * Replaces the store's texts with a new extraction and records when it was made, in one batch. Translations are never
	 * deleted, so a text that goes away keeps its translation for when it comes back. What shoppers see is unchanged.
	 */
	async replaceTexts(appId: string, texts: readonly StoreText[], now: number): Promise<void> {
		const stored = schema.storeTexts;
		const settings = schema.storeTranslationSettings;
		const inserts = chunked(texts, Math.floor(D1_MAX_PARAMETERS / TEXT_COLUMNS)).map((chunk) =>
			this.database
				.insert(stored)
				.values(chunk.map((text) => ({ appId, sourceHash: text.hash, sourceText: text.text, kind: text.kind, seenAt: now })))
				.onConflictDoNothing({ target: [stored.appId, stored.sourceHash] }),
		);
		await this.batchWithSettings(
			appId,
			now,
			this.database.delete(stored).where(eq(stored.appId, appId)),
			...inserts,
			this.database.update(settings).set({ extractedAt: now }).where(eq(settings.appId, appId)),
		);
	}

	/**
	 * Texts with no translation into `locale`, in the order they were read, so batches are stable. A text with any
	 * translation, the seller's included, is never missing. `exclude` leaves out hashes a task gave up on.
	 */
	async missingTexts(appId: string, locale: Locale, limit: number, exclude: readonly string[] = []): Promise<StoreText[]> {
		const texts = schema.storeTexts;
		return this.database
			.select({ hash: texts.sourceHash, text: texts.sourceText, kind: texts.kind })
			.from(texts)
			.where(this.missing(appId, locale, exclude))
			.orderBy(asc(texts.seenAt), asc(rowidOf(texts)))
			.limit(limit)
			.all();
	}

	/** How many texts `missingTexts` would list without a limit. */
	async countMissing(appId: string, locale: Locale, exclude: readonly string[] = []): Promise<number> {
		const row = await this.database.select({ missing: count() }).from(schema.storeTexts).where(this.missing(appId, locale, exclude)).get();
		return row?.missing ?? 0;
	}

	/** How far each language is against the store's current texts. */
	async counts(appId: string): Promise<Record<Locale, StoreTranslationCounts>> {
		const texts = schema.storeTexts;
		const translations = schema.storeTranslations;
		const [totals, byLocale] = await this.database.batch([
			this.database.select({ total: count() }).from(texts).where(eq(texts.appId, appId)),
			this.database
				.select({ locale: translations.locale, translated: count(), edited: sql<number>`coalesce(sum(${translations.origin} = 'seller'), 0)` })
				.from(translations)
				.innerJoin(texts, and(eq(texts.appId, translations.appId), eq(texts.sourceHash, translations.sourceHash)))
				.where(eq(translations.appId, appId))
				.groupBy(translations.locale),
		]);
		const total = totals[0]?.total ?? 0;
		const counts = Object.fromEntries(LOCALES.map((locale) => [locale, { total, translated: 0, edited: 0 }])) as Record<Locale, StoreTranslationCounts>;
		for (const row of byLocale) counts[row.locale] = { total, translated: row.translated, edited: row.edited };
		return counts;
	}

	/**
	 * Saves the machine's translations. A text the seller edited keeps their words, and only the machine text they can go
	 * back to is refreshed. A write of nothing changes nothing.
	 */
	async upsertMachine(appId: string, locale: Locale, rows: readonly MachineTranslation[], now: number = Date.now()): Promise<void> {
		if (rows.length === 0) return;
		const translations = schema.storeTranslations;
		const inserts = chunked(rows, Math.floor(D1_MAX_PARAMETERS / TRANSLATION_COLUMNS)).map((chunk) =>
			this.database
				.insert(translations)
				.values(chunk.map((row) => ({ appId, locale, sourceHash: row.hash, sourceText: row.source, text: row.text, origin: 'machine' as const, machineText: row.text, updatedAt: now })))
				.onConflictDoUpdate({
					target: [translations.appId, translations.locale, translations.sourceHash],
					set: {
						text: sql`CASE WHEN ${translations.origin} = 'seller' THEN ${translations.text} ELSE excluded.text END`,
						machineText: sql`excluded.machine_text`,
						updatedAt: sql`CASE WHEN ${translations.origin} = 'seller' THEN ${translations.updatedAt} ELSE excluded.updated_at END`,
					},
				}),
		);
		await this.batchWithSettings(appId, now, ...inserts, this.bumpVersion(appId, now));
	}

	/**
	 * The seller's own words for a text, which no task overwrites. False when the store has no such text.
	 */
	async setSellerText(appId: string, locale: Locale, hash: string, text: string, now: number = Date.now()): Promise<boolean> {
		const translations = schema.storeTranslations;
		const source = await this.sourceTextOf(appId, locale, hash);
		if (source === null) return false;
		await this.batchWithSettings(
			appId,
			now,
			this.database
				.insert(translations)
				.values({ appId, locale, sourceHash: hash, sourceText: source, text, origin: 'seller', machineText: null, updatedAt: now })
				.onConflictDoUpdate({ target: [translations.appId, translations.locale, translations.sourceHash], set: { text, origin: 'seller', updatedAt: now } }),
			this.bumpVersion(appId, now),
		);
		return true;
	}

	/** Gives a text back its machine translation. False when the seller hasn't edited it or the machine never translated it. */
	async revertToMachine(appId: string, locale: Locale, hash: string, now: number = Date.now()): Promise<boolean> {
		const translations = schema.storeTranslations;
		const key = and(eq(translations.appId, appId), eq(translations.locale, locale), eq(translations.sourceHash, hash));
		const edited = await this.database
			.select({ one: sql`1` })
			.from(translations)
			.where(and(key, eq(translations.origin, 'seller'), isNotNull(translations.machineText)))
			.get();
		if (!edited) return false;
		await this.database.batch([
			this.database
				.update(translations)
				.set({ text: sql`${translations.machineText}`, origin: 'machine', updatedAt: now })
				.where(and(key, eq(translations.origin, 'seller'), isNotNull(translations.machineText))),
			this.bumpVersion(appId, now),
		]);
		return true;
	}

	/** The store's current texts with their translations into `locale`, in reading order, filtered by a search of either. */
	async listRows(appId: string, locale: Locale, options: { query?: string; cursor?: string; limit: number }): Promise<StoreTranslationPage> {
		const texts = schema.storeTexts;
		const translations = schema.storeTranslations;
		const rowid = rowidOf(texts);
		const limit = Math.max(1, Math.min(Math.floor(options.limit), MAX_LIST_ROWS));
		const query = options.query?.trim().slice(0, MAX_QUERY_CHARS) ?? '';
		const cursor = options.cursor === undefined ? null : CURSOR.exec(options.cursor);
		const rows = await this.database
			.select({ hash: texts.sourceHash, source: texts.sourceText, text: translations.text, origin: translations.origin, machineText: translations.machineText, seenAt: texts.seenAt, rowid })
			.from(texts)
			.leftJoin(translations, and(eq(translations.appId, texts.appId), eq(translations.locale, locale), eq(translations.sourceHash, texts.sourceHash)))
			.where(
				and(
					eq(texts.appId, appId),
					query === '' ? undefined : or(containing(texts.sourceText, query), containing(translations.text, query)),
					cursor ? sql`(${texts.seenAt}, ${rowid}) > (${Number(cursor[1])}, ${Number(cursor[2])})` : undefined,
				),
			)
			.orderBy(asc(texts.seenAt), asc(rowid))
			.limit(limit + 1)
			.all();
		const page = rows.slice(0, limit);
		const last = page[page.length - 1];
		return {
			rows: page.map(({ hash, source, text, origin, machineText }): StoreTranslationRow => ({ hash, source, text, origin, machineText })),
			nextCursor: rows.length > limit && last ? `${last.seenAt}:${last.rowid}` : null,
		};
	}

	/** Every translation into `locale` by source hash, including those of texts the store no longer shows: what serving reads. */
	async dictionary(appId: string, locale: Locale): Promise<Map<string, string>> {
		const translations = schema.storeTranslations;
		const rows = await this.database
			.select({ hash: translations.sourceHash, text: translations.text })
			.from(translations)
			.where(and(eq(translations.appId, appId), eq(translations.locale, locale)))
			.all();
		return new Map(rows.map((row) => [row.hash, row.text]));
	}

	/** The store's texts with no translation into `locale`. The excluded hashes go in as one JSON value, since D1 binds at most 100 parameters. */
	private missing(appId: string, locale: Locale, exclude: readonly string[]): SQL | undefined {
		const texts = schema.storeTexts;
		const translations = schema.storeTranslations;
		return and(
			eq(texts.appId, appId),
			notExists(
				this.database
					.select({ one: sql`1` })
					.from(translations)
					.where(and(eq(translations.appId, texts.appId), eq(translations.locale, locale), eq(translations.sourceHash, texts.sourceHash))),
			),
			exclude.length === 0 ? undefined : sql`${texts.sourceHash} NOT IN (SELECT value FROM json_each(${JSON.stringify(exclude)}))`,
		);
	}

	/** The language the store is written in until the seller says otherwise: its owner's own, when Estori speaks it. */
	private async defaultSourceLocale(appId: string): Promise<Locale> {
		const owner = await this.database.select({ userId: schema.apps.userId }).from(schema.apps).where(eq(schema.apps.id, appId)).get();
		const saved = owner?.userId ? await new LocalePreferenceService(this.env).locale(owner.userId) : null;
		return saved ?? DEFAULT_LOCALE;
	}

	/** Runs the statements in one batch, after creating the store's settings row when it has none so they can bump its version. */
	private async batchWithSettings(appId: string, now: number, ...statements: BatchItem<'sqlite'>[]): Promise<void> {
		const settings = schema.storeTranslationSettings;
		const ensure = this.database
			.insert(settings)
			.values({ appId, sourceLocale: await this.defaultSourceLocale(appId), updatedAt: now })
			.onConflictDoNothing({ target: settings.appId });
		await this.database.batch([ensure, ...statements]);
	}

	private bumpVersion(appId: string, now: number) {
		const settings = schema.storeTranslationSettings;
		return this.database
			.update(settings)
			.set({ version: sql`${settings.version} + 1`, updatedAt: now })
			.where(eq(settings.appId, appId));
	}

	/** The text a translation is of: the store's current text, or else what its translation recorded when the text went away. */
	private async sourceTextOf(appId: string, locale: Locale, hash: string): Promise<string | null> {
		const texts = schema.storeTexts;
		const translations = schema.storeTranslations;
		const current = await this.database.select({ text: texts.sourceText }).from(texts).where(and(eq(texts.appId, appId), eq(texts.sourceHash, hash))).get();
		if (current) return current.text;
		const old = await this.database
			.select({ text: translations.sourceText })
			.from(translations)
			.where(and(eq(translations.appId, appId), eq(translations.locale, locale), eq(translations.sourceHash, hash)))
			.get();
		return old?.text ?? null;
	}
}

/** The row's rowid, which keeps the order rows were inserted in. */
function rowidOf(table: typeof schema.storeTexts): SQL<number> {
	return sql<number>`${table}.rowid`;
}

/** The column contains the text, ignoring ASCII case. Wildcards are plain characters, and D1 limits LIKE patterns to 50 bytes. */
function containing(column: AnyColumn, text: string): SQL {
	return sql`instr(lower(${column}), lower(${text})) > 0`;
}
