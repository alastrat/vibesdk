import { Navigate } from 'react-router';
import { PageMeta } from '@/components/public-site/solution-page';
import { useAuth } from '@/contexts/auth-context';

/**
 * Where Start building free leads. Blank until the signup design is settled
 * (docs/superpowers/specs/2026-10-15-signup-proposal.md); people already signed in go to the builder.
 */
export default function SignupPage() {
	const { isAuthenticated } = useAuth();
	if (isAuthenticated) return <Navigate to="/" replace />;
	return (
		<section aria-labelledby="signup-title" className="min-h-[60svh] bg-white">
			<PageMeta title="Sign up" description="Create your free Estori account and start building your store." />
			<h1 id="signup-title" className="sr-only">
				Sign up
			</h1>
		</section>
	);
}
