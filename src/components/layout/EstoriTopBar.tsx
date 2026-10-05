import { Link } from 'react-router';
import { SignInIcon } from '@phosphor-icons/react';
import { useAuth } from '@/contexts/auth-context';
import { useAuthModal } from '@/components/auth/AuthModalProvider';
import { AuthButton } from '@/components/auth/auth-button';
import { OrangeButton } from '@/components/shared/OrangeButton';
import { BRAND, EstoriLogo } from '@/brand';

/** Full-width navy bar above the sidebar: logo, account menu and Sign In. */
export function EstoriTopBar() {
	const { user, isLoading: authLoading } = useAuth();
	const { showAuthModal } = useAuthModal();

	return (
		<header className="flex h-(--estori-topbar-h) shrink-0 items-center justify-between border-b border-(--estori-topbar-line) bg-(--estori-topbar) px-4 text-(--estori-topbar-text)">
			<Link to="/" aria-label={`${BRAND.name} home`} className="flex items-center">
				<EstoriLogo className="h-6 w-auto" />
			</Link>
			<div className="flex items-center gap-2">
				{user && <AuthButton display="icon" />}
				{!authLoading && !user && (
					<OrangeButton
						size="sm"
						onClick={() => showAuthModal()}
						icon={<SignInIcon className="size-4" />}
					>
						Sign In
					</OrangeButton>
				)}
			</div>
		</header>
	);
}
