import { t } from '@/lib/i18n';

export type AppVisibility = 'private' | 'team' | 'board' | 'public';

/** Who can see an app, as a badge label in the active language. */
export function visibilityLabel(visibility: AppVisibility): string {
	switch (visibility) {
		case 'private':
			return t('Private');
		case 'team':
			return t('Team');
		case 'board':
			return t('Board');
		case 'public':
			return t('Public');
	}
}
