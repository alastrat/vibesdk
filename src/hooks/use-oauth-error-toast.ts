import { useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';

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
			email_exists:
				'An account with this email already exists. Sign in with your existing method, then link the provider from Settings.',
			oauth_failed:
				'The sign-in provider reported an error. Please try again.',
			auth_failed: 'Sign-in failed. Please try again.',
		};
		toast.error(messages[authError] ?? messages.auth_failed);
		searchParams.delete('error');
		setSearchParams(searchParams, { replace: true });
	}, [searchParams, setSearchParams]);
}
