import { Link, useNavigate } from 'react-router';
import { QuestionIcon, SignInIcon } from '@phosphor-icons/react';
import { Button } from '@cloudflare/kumo';
import { useAuth } from '@/contexts/auth-context';
import { useAuthModal } from '@/components/auth/AuthModalProvider';
import { AuthButton } from '@/components/auth/auth-button';
import { OrangeButton } from '@/components/shared/OrangeButton';
import { BRAND, EstoriLogo } from '@/brand';
import { useI18n } from '@/lib/i18n';
import { WorkspaceSearch } from './workspace-search';

/** Workspace identity and account controls, shared by every authenticated view. */
export function EstoriTopBar({ storeWorkspace = false }: { storeWorkspace?: boolean }) {
	const { t } = useI18n();
	const navigate = useNavigate();
	const { user, isLoading: authLoading } = useAuth();
	const { showAuthModal } = useAuthModal();

	return (
		<header className="workspace-topbar flex shrink-0 items-center justify-between px-5">
			<Link
				to={user ? '/apps' : '/'}
				aria-label={t('{brand} home', { brand: BRAND.name })}
				className="flex items-center"
			>
				<EstoriLogo className="h-7 w-auto" />
				<span className="workspace-label">{storeWorkspace ? t('Store workspace') : t('Workspace')}</span>
			</Link>
			<div className="workspace-topbar-actions flex items-center gap-2">
				{user && <WorkspaceSearch key={user.id} />}
				{user && (
					<>
						<Button
							variant="ghost"
							shape="square"
							aria-label={t('Help and support')}
							onClick={() => navigate('/contact')}
						>
							<QuestionIcon className="size-5" />
						</Button>
						<AuthButton display="icon" />
					</>
				)}
				{!authLoading && !user && (
					<OrangeButton
						size="sm"
						onClick={() => showAuthModal()}
						icon={<SignInIcon className="size-4" />}
					>
						{t('Sign In')}
					</OrangeButton>
				)}
			</div>
		</header>
	);
}
