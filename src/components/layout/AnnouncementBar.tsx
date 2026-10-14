import { Link } from 'react-router';
import { PLATFORM_FEE_LABEL } from '@/api-types';
import { useAuth } from '@/contexts/auth-context';
import { useAuthModal } from '@/components/auth/AuthModalProvider';

/** Gold strip above the top bar, as on 1Password: the Discover news, plus Sign in on wider screens. */
export function AnnouncementBar() {
	const { isAuthenticated } = useAuth();
	const { showAuthModal } = useAuthModal();
	return (
		<div className="bg-public-gold text-public-charcoal">
			<div className="mx-auto flex h-11 max-w-[1248px] items-center justify-between gap-4 px-4 text-[13px] sm:px-6">
				<p className="min-w-0 truncate">
					Estori Discover is open: sell the stores you design and keep the price minus {PLATFORM_FEE_LABEL}.{' '}
					<Link to="/#creators" className="underline underline-offset-4">
						Learn more →
					</Link>
				</p>
				{!isAuthenticated && (
					<button type="button" onClick={() => showAuthModal()} className="hidden shrink-0 hover:underline sm:inline">
						Sign in
					</button>
				)}
			</div>
		</div>
	);
}
