import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useAuthModal } from '@/components/auth/AuthModalProvider';
import { useAuth } from '@/contexts/auth-context';

/**
 * A shareable link to sign up: it opens the sign-up window over the home page. People already signed in just land on
 * the home page, which is their builder.
 */
export default function SignupPage() {
	const { isAuthenticated, isLoading } = useAuth();
	const { showAuthModal } = useAuthModal();
	const navigate = useNavigate();

	useEffect(() => {
		if (isLoading) return;
		if (!isAuthenticated) showAuthModal(undefined, undefined, undefined, { initialMode: 'register' });
		navigate('/', { replace: true });
	}, [isLoading, isAuthenticated, showAuthModal, navigate]);

	return null;
}
