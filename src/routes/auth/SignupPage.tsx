import { Navigate, useNavigate } from 'react-router';
import { AuthForm, authCopy } from '@/components/auth/AuthForm';
import { AuthPageLayout } from '@/components/auth/AuthPageLayout';
import { useAuth } from '@/contexts/auth-context';
import { t } from '@/lib/i18n';

/** Signing up, on a page of its own. People already signed in go to the builder. */
export default function SignupPage() {
	const { isAuthenticated, login, getIntendedUrl } = useAuth();
	const navigate = useNavigate();
	if (isAuthenticated) return <Navigate to="/" replace />;

	const { title, description } = authCopy('register');
	return (
		<AuthPageLayout view="register" pageTitle={t('Sign up')} title={title} description={description}>
			<AuthForm
				mode="register"
				onOAuthLogin={(provider) => login(provider, getIntendedUrl() ?? '/')}
				onSignIn={() => navigate('/login')}
			/>
		</AuthPageLayout>
	);
}
