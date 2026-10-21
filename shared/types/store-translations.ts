/** Where a store text came from: page markup, scripts and server modules, or the product manifest. */
export type StoreTextKind = 'page' | 'script' | 'product';

/** A text longer than this is not translated. */
export const MAX_TEXT_CHARS = 5_000;

/** A store yields at most this many distinct texts; past it the extraction reports that it stopped. */
export const MAX_STORE_TEXTS = 5_000;
