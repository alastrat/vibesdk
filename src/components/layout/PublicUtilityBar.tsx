import { useLocale, t } from '@/lib/i18n';
import { marketingCopy } from '@/content/marketing-copy';
import { Link } from 'react-router';
import { useAuth } from '@/contexts/auth-context';
import { useAuthModal } from '@/components/auth/AuthModalProvider';
import { PublicLanguageMenu } from './PublicLanguageMenu';

/** Public utilities sit between the announcement and main navigation. */
export function PublicUtilityBar() {
	useLocale();
	const { isAuthenticated } = useAuth();
	const { showAuthModal } = useAuthModal();
	return (
		<div className="border-b border-[#d5d8de] bg-[#f1f2f4] text-public-charcoal">
			<div className="mx-auto flex h-[39px] max-w-[1296px] items-center justify-end px-4 text-[13px] sm:px-6">
				<nav aria-label={t(marketingCopy.navigation.accessibility.utility)} className="flex items-center gap-3 sm:gap-5">
					<PublicLanguageMenu />
					{isAuthenticated ? (
						<Link to="/" className="text-public-charcoal/75 hover:text-public-charcoal focus-visible:outline-2 focus-visible:outline-public-blue">
							{t(marketingCopy.navigation.openApp)}</Link>
					) : (
						<button type="button" onClick={() => showAuthModal()} className="text-public-charcoal/75 hover:text-public-charcoal focus-visible:outline-2 focus-visible:outline-public-blue">
							{t(marketingCopy.navigation.signIn)}</button>
					)}
				</nav>
			</div>
		</div>
	);
}
