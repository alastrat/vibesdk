/** SQL over `users.preferences`, the JSON column that holds an account's settings. */

import { sql } from 'drizzle-orm';
import * as schema from './schema';

/** The stored preferences when they are a JSON object; a NULL, a JSON string or invalid JSON starts over from `{}`. */
export const PREFERENCES_OBJECT = sql`CASE WHEN json_valid(${schema.users.preferences}) AND json_type(${schema.users.preferences}) = 'object' THEN ${schema.users.preferences} ELSE '{}' END`;

/** The saved language as stored, which may be any JSON value; null when none is saved. */
export const SAVED_LOCALE = sql<unknown>`json_extract(${PREFERENCES_OBJECT}, '$.locale')`;
