import { msg } from '../i18n/translate';
/** Mirrors of the drafts values in space/src/space/drafts-store.ts, for the frontend. */
export const MAIN_DRAFT_ID = 'main';
export const DRAFT_NAME_MAX_LENGTH = 40;
/** Drafts per store, counting Main. Mirrors DRAFT_LIMIT in space/src/space/drafts-store.ts. */
export const DRAFT_LIMIT = 5;
/** The refusal while the store-drafts-paused flag is on. */
export const STORE_DRAFTS_PAUSED_MESSAGE = msg('Starting new drafts is paused right now.');
