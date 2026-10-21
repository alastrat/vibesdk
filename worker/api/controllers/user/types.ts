/**
 * Type definitions for User Controller responses
 */

import { EnhancedAppData, PaginationInfo } from '../../../database/types';
import type { Locale } from '../../../../shared/i18n/locales';

/**
 * Response data for getApps
 */
export interface UserAppsData {
    apps: EnhancedAppData[];
    pagination: PaginationInfo;
}

/**
 * Response data for updateProfile
 */
export interface ProfileUpdateData {
    success: boolean;
    message: string;
}

/**
 * Response data for setLocale
 */
export interface LocalePreferenceData {
    locale: Locale;
}
