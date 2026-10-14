import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Banner, Input, buttonVariants, cn } from '@cloudflare/kumo';
import { CheckCircleIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { RESET_LINK_INVALID_MESSAGE } from '@/api-types';
import { pageTitle } from '@/brand';
import { useAuth } from '@/contexts/auth-context';
import { useAuthModal } from '@/components/auth/AuthModalProvider';
import { PasswordField } from '@/components/auth/PasswordField';
import { OrangeButton } from '@/components/shared/OrangeButton';
import { apiClient } from '@/lib/api-client';
import { newPasswordErrors, type NewPasswordErrors } from '@/lib/auth-validation';
import { AccountEmailCard } from './AccountEmailCard';

type ResetOutcome = 'form' | 'updated' | 'invalid';

const RESET_FAILED_MESSAGE = "Couldn't update your password. Try again.";

/** Sets a new password from an emailed reset link. */
export default function ResetPasswordPage() {
	const [searchParams] = useSearchParams();
	const token = searchParams.get('token');
	const { isAuthenticated, refreshUser } = useAuth();
	const { showAuthModal } = useAuthModal();

	const [outcome, setOutcome] = useState<ResetOutcome>(token ? 'form' : 'invalid');
	const [newPassword, setNewPassword] = useState('');
	const [confirmPassword, setConfirmPassword] = useState('');
	const [showPassword, setShowPassword] = useState(false);
	const [fieldErrors, setFieldErrors] = useState<NewPasswordErrors>({});
	const [formError, setFormError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);

	const handleSubmit = async (event: FormEvent) => {
		event.preventDefault();
		if (!token) return;

		const errors = newPasswordErrors(newPassword, confirmPassword);
		setFieldErrors(errors);
		if (Object.keys(errors).length > 0) return;

		setSubmitting(true);
		setFormError(null);
		try {
			const response = await apiClient.resetPassword(token, newPassword, confirmPassword);
			if (!response.success) throw new Error(response.error?.message || RESET_FAILED_MESSAGE);
			// The reset signs out every session, including any in this browser.
			await refreshUser();
			setOutcome('updated');
		} catch (error) {
			const message = error instanceof Error && error.message ? error.message : RESET_FAILED_MESSAGE;
			if (message === RESET_LINK_INVALID_MESSAGE) {
				setOutcome('invalid');
			} else {
				setFormError(message);
			}
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<>
			<title>{pageTitle('Reset password')}</title>
			<AccountEmailCard title="Reset your password">
				{outcome === 'form' && (
					<form onSubmit={handleSubmit} className="grid gap-3" noValidate>
						<p className="text-sm text-kumo-subtle">Choose a new password for your account.</p>
						{formError && <Banner variant="error" icon={<WarningCircleIcon />} title={formError} />}
						<PasswordField
							label="New password"
							value={newPassword}
							onChange={setNewPassword}
							error={fieldErrors.password}
							disabled={submitting}
							autoComplete="new-password"
							visible={showPassword}
							onVisibleChange={setShowPassword}
						/>
						<div className="w-full min-w-0 [&_input]:w-full [&_[data-slot=field]]:gap-1.5">
							<Input
								label="Confirm password"
								type="password"
								placeholder="Confirm password"
								value={confirmPassword}
								onChange={(e) => setConfirmPassword(e.target.value)}
								error={fieldErrors.confirmPassword}
								disabled={submitting}
								autoComplete="new-password"
								className="w-full"
							/>
						</div>
						<OrangeButton type="submit" disabled={submitting} className="mt-1 w-full justify-center">
							{submitting ? 'Updating...' : 'Update password'}
						</OrangeButton>
					</form>
				)}

				{outcome === 'updated' && (
					<>
						<Banner
							icon={<CheckCircleIcon />}
							description="Your password is updated. Sign in with your new password."
						/>
						{/* Signed in as another account in this browser: the sign-in window would close at once. */}
						{isAuthenticated ? (
							<Link to="/" className={cn(buttonVariants({ variant: 'secondary' }), 'w-full justify-center')}>
								Open app
							</Link>
						) : (
							<OrangeButton className="w-full justify-center" onClick={() => showAuthModal()}>
								Sign in
							</OrangeButton>
						)}
					</>
				)}

				{outcome === 'invalid' && (
					<>
						<Banner variant="error" icon={<WarningCircleIcon />} title={RESET_LINK_INVALID_MESSAGE} />
						<OrangeButton
							className="w-full justify-center"
							onClick={() => showAuthModal(undefined, undefined, undefined, { initialMode: 'forgot' })}
						>
							Request a new link
						</OrangeButton>
					</>
				)}
			</AccountEmailCard>
		</>
	);
}
