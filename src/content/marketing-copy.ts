import english from './marketing/en.json';

/** Canonical English marketing copy. Translate its display values at render time with t(). */
export const marketingCopy = english;
export { interpolate as formatMarketingCopy } from '../../shared/i18n/translate';
