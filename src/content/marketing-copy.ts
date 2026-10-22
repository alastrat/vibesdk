import english from './marketing/en.json';

/** English marketing copy, kept separate while its wording is being refined. */
export const marketingCopy = english;
export { interpolate as formatMarketingCopy } from '../../shared/i18n/translate';
