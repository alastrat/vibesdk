import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { AuthForm, authCopy, type SignInView } from '@/components/auth/AuthForm';
import { AuthPageLayout } from '@/components/auth/AuthPageLayout';
import { useAuth } from '@/contexts/auth-context';

/** Signing in, on a page of its own, for links that lead straight here. People already signed in go to the builder. */
export default function LoginPage() {
	const { isAuthenticated, login, getIntendedUrl } = useAuth();
	const navigate = useNavigate();
	const [mode, setMode] = useState<SignInView>('login');
	if (isAuthenticated) return <Navigate to="/" replace />;

	const { title, description } = authCopy(mode);
	return (
		<AuthPageLayout view="login" pageTitle="Sign in" title={title} description={description}>
			<AuthForm
				mode={mode}
				onModeChange={(next) => next !== 'register' && setMode(next)}
				onOAuthLogin={(provider) => login(provider, getIntendedUrl() ?? '/')}
				onCreateAccount={() => navigate('/signup')}
			/>
		</AuthPageLayout>
	);
}
