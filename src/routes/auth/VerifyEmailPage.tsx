import { useCallback, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Banner, Button, buttonVariants, cn } from '@cloudflare/kumo';
import { CheckCircleIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { CONFIRM_LINK_INVALID_MESSAGE } from '@/api-types';
import { BRAND, pageTitle } from '@/brand';
import { useAuth } from '@/contexts/auth-context';
import { useAuthModal } from '@/components/auth/AuthModalProvider';
import { OrangeButton } from '@/components/shared/OrangeButton';
import { apiClient } from '@/lib/api-client';
import { AccountEmailCard } from './AccountEmailCard';

type ConfirmState =
	| { status: 'ready' }
	| { status: 'confirming' }
	| { status: 'confirmed' }
	| { status: 'invalid' }
	| { status: 'failed'; message: string };

const CONFIRM_FAILED_MESSAGE = "Couldn't confirm your email. Try again.";

/**
 * Confirms an email address from an emailed confirmation link. It waits for a click, because
 * link scanners open pages too and must not confirm an address nobody asked to confirm.
 */
export default function VerifyEmailPage() {
	const [searchParams] = useSearchParams();
	const token = searchParams.get('token');
	const { isAuthenticated, refreshUser } = useAuth();
	const { showAuthModal } = useAuthModal();
	const [state, setState] = useState<ConfirmState>(token ? { status: 'ready' } : { status: 'invalid' });
	// Each link is single use, so a second click before the answer must not post it again.
	const pending = useRef(false);

	const confirm = useCallback(async () => {
		if (!token || pending.current) return;
		pending.current = true;
		setState({ status: 'confirming' });
		try {
			const response = await apiClient.verifyEmail(token);
			if (!response.success) throw new Error(response.error?.message || CONFIRM_FAILED_MESSAGE);
			setState({ status: 'confirmed' });
			// Updates the confirmation status shown in Settings; a no-op when signed out.
			await refreshUser();
		} catch (error) {
			const message = error instanceof Error && error.message ? error.message : CONFIRM_FAILED_MESSAGE;
			setState(message === CONFIRM_LINK_INVALID_MESSAGE ? { status: 'invalid' } : { status: 'failed', message });
		} finally {
			pending.current = false;
		}
	}, [token, refreshUser]);

	return (
		<>
			<title>{pageTitle('Confirm email')}</title>
			<AccountEmailCard title="Confirm your email">
				{(state.status === 'ready' || state.status === 'confirming') && (
					<>
						<p className="text-sm text-kumo-subtle">Confirm that this email address is yours.</p>
						<p className="text-sm text-kumo-subtle">Only confirm if you created an Estori account with this address.</p>
						<OrangeButton
							className="w-full justify-center"
							loading={state.status === 'confirming'}
							disabled={state.status === 'confirming'}
							onClick={() => void confirm()}
						>
							Confirm my email
						</OrangeButton>
					</>
				)}

				{state.status === 'confirmed' && (
					<>
						<Banner icon={<CheckCircleIcon />} description="Your email is confirmed." />
						<Link to="/" className={cn(buttonVariants({ variant: 'secondary' }), 'w-full justify-center')}>
							Continue to {BRAND.name}
						</Link>
					</>
				)}

				{state.status === 'invalid' && (
					<>
						<Banner variant="error" icon={<WarningCircleIcon />} title={CONFIRM_LINK_INVALID_MESSAGE} />
						<p className="text-sm text-kumo-subtle">
							Need a new link?{' '}
							<Link
								to="/settings"
								className="text-kumo-link underline hover:text-kumo-strong"
								onClick={(event) => {
									// Settings needs a session; signed-out visitors sign in first and land there.
									if (isAuthenticated) return;
									event.preventDefault();
									showAuthModal('to open Settings', undefined, '/settings');
								}}
							>
								Resend it from Settings
							</Link>
							.
						</p>
					</>
				)}

				{state.status === 'failed' && (
					<>
						<Banner variant="error" icon={<WarningCircleIcon />} title={state.message} />
						<Button variant="secondary" className="w-full justify-center" onClick={() => void confirm()}>
							Try again
						</Button>
					</>
				)}
			</AccountEmailCard>
		</>
	);
}
