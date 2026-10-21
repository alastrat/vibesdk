import { useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { SIGNUPS_PAUSED_ERROR_CODE, SIGNUPS_PAUSED_MESSAGE } from '@/api-types';
import { t } from '@/lib/i18n';

/**
 * Surface auth failures redirected to `/` from the OAuth callback (e.g. an email
 * that already belongs to an account created via a different method).
 */
export function useOAuthErrorToast(): void {
	const [searchParams, setSearchParams] = useSearchParams();
	useEffect(() => {
		const authError = searchParams.get('error');
		if (!authError) return;
		const messages: Record<string, string> = {
			email_exists: t(
				'An account with this email already exists. Sign in with your existing method, then link the provider from Settings.',
			),
			oauth_failed: t('The sign-in provider reported an error. Please try again.'),
			auth_failed: t('Sign-in failed. Please try again.'),
			[SIGNUPS_PAUSED_ERROR_CODE]: t(SIGNUPS_PAUSED_MESSAGE),
		};
		toast.error(messages[authError] ?? messages.auth_failed);
		searchParams.delete('error');
		setSearchParams(searchParams, { replace: true });
	}, [searchParams, setSearchParams]);
}
