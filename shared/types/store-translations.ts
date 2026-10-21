/** Where a store text came from: page markup, scripts and server modules, or the product manifest. */
export type StoreTextKind = 'page' | 'script' | 'product';

/** A text longer than this is not translated. */
export const MAX_TEXT_CHARS = 5_000;

/** A store yields at most this many distinct texts; past it the extraction reports that it stopped. */
export const MAX_STORE_TEXTS = 5_000;

/** An entry of THINK_MODELS, so every call is priced from its real token usage. */
export const TASK_MODEL_ID = 'google-ai-studio/gemini-3.6-flash';

/** A task's step translates one batch: at most this many texts or characters. */
export const TRANSLATION_BATCH_MAX_TEXTS = 40;
export const TRANSLATION_BATCH_MAX_CHARS = 12_000;
