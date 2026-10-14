import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Banner, Button, buttonVariants, cn } from '@cloudflare/kumo';
import { CheckCircleIcon, CircleNotchIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { CONFIRM_LINK_INVALID_MESSAGE } from '@/api-types';
import { BRAND, pageTitle } from '@/brand';
import { useAuth } from '@/contexts/auth-context';
import { useAuthModal } from '@/components/auth/AuthModalProvider';
import { apiClient } from '@/lib/api-client';
import { AccountEmailCard } from './AccountEmailCard';

type ConfirmState =
	| { status: 'confirming' }
	| { status: 'confirmed' }
	| { status: 'invalid' }
	| { status: 'failed'; message: string };

const CONFIRM_FAILED_MESSAGE = "Couldn't confirm your email. Try again.";

/** Confirms an email address from an emailed confirmation link. */
export default function VerifyEmailPage() {
	const [searchParams] = useSearchParams();
	const token = searchParams.get('token');
	const { isAuthenticated, refreshUser } = useAuth();
	const { showAuthModal } = useAuthModal();
	const [state, setState] = useState<ConfirmState>(token ? { status: 'confirming' } : { status: 'invalid' });
	// Each link is single use, so a repeated effect must not post it twice.
	const requested = useRef(false);

	const confirm = useCallback(
		async (value: string) => {
			setState({ status: 'confirming' });
			try {
				const response = await apiClient.verifyEmail(value);
				if (!response.success) throw new Error(response.error?.message || CONFIRM_FAILED_MESSAGE);
				setState({ status: 'confirmed' });
				// Updates the confirmation status shown in Settings; a no-op when signed out.
				await refreshUser();
			} catch (error) {
				const message = error instanceof Error && error.message ? error.message : CONFIRM_FAILED_MESSAGE;
				setState(message === CONFIRM_LINK_INVALID_MESSAGE ? { status: 'invalid' } : { status: 'failed', message });
			}
		},
		[refreshUser],
	);

	useEffect(() => {
		if (!token || requested.current) return;
		requested.current = true;
		void confirm(token);
	}, [token, confirm]);

	return (
		<>
			<title>{pageTitle('Confirm email')}</title>
			<AccountEmailCard title="Confirm your email">
				{state.status === 'confirming' && (
					<p className="flex items-center gap-2 text-sm text-kumo-subtle">
						<CircleNotchIcon className="size-4 animate-spin" />
						Confirming your email…
					</p>
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

				{state.status === 'failed' && token && (
					<>
						<Banner variant="error" icon={<WarningCircleIcon />} title={state.message} />
						<Button variant="secondary" className="w-full justify-center" onClick={() => void confirm(token)}>
							Try again
						</Button>
					</>
				)}
			</AccountEmailCard>
		</>
	);
}
