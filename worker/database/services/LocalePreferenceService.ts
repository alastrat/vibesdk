/** The language an account chose. It lives in `users.preferences` JSON, beside the analytics setting. */

import { eq, sql } from 'drizzle-orm';
import * as schema from '../schema';
import { PREFERENCES_OBJECT, SAVED_LOCALE } from '../preferences-sql';
import { BaseService } from './BaseService';
import { isLocale, type Locale } from '../../../shared/i18n/locales';

export class LocalePreferenceService extends BaseService {
	/** The saved language; null when the user never chose one, doesn't exist, or holds a value we don't speak. */
	async locale(userId: string): Promise<Locale | null> {
		const row = await this.database.select({ locale: SAVED_LOCALE }).from(schema.users).where(eq(schema.users.id, userId)).get();
		return isLocale(row?.locale) ? row.locale : null;
	}

	/** Keeps every other preference. */
	async setLocale(userId: string, locale: Locale, now: Date): Promise<void> {
		await this.database
			.update(schema.users)
			.set({ preferences: sql`json_set(${PREFERENCES_OBJECT}, '$.locale', ${locale})`, updatedAt: now })
			.where(eq(schema.users.id, userId))
			.run();
	}
}
