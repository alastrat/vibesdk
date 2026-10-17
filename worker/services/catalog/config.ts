/** Worker-only catalog settings: CJ's limits, refresh budgets and selling rules. */

export const CJ_API_BASE = 'https://developers.cjdropshipping.com/api2.0/v1/';
/** CJ allows one call a second at its Free level. */
export const CJ_MIN_CALL_INTERVAL_MS = 1100;
export const CJ_THROTTLED_WAIT_MS = 1200;
export const CJ_REQUEST_TIMEOUT_MS = 15_000;
/** The refresh stops below this many points, so placements keep points for their freight quote. */
export const CJ_POINTS_RESERVE = 5000;

export const CATALOG_REFRESH_BATCH = 15;
export const CATALOG_DETAILS_MAX_AGE_MS = 6 * 60 * 60 * 1000;
export const CATALOG_REFRESH_CLAIM_MS = 10 * 60 * 1000;
/** A buffer against selling the last units twice. */
export const CATALOG_MIN_STOCK = 10;
export const CATALOG_MAX_DELIVERY_DAYS: Readonly<Record<string, number>> = { US: 10 };
/** Older offers lock as unavailable: Estori stops selling at prices it can no longer vouch for. */
export const CATALOG_OFFER_MAX_AGE_MS = 72 * 60 * 60 * 1000;
export const CATALOG_MAX_IMAGES = 8;
export const CATALOG_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const CATALOG_MAX_DESCRIPTION = 5000;
