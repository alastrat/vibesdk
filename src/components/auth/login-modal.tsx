/**
 * The sign-in and sign-up window: a photo filling the left column on wider screens, and on the right Google first,
 * the other providers, then email and password.
 */

import { useState } from 'react';
import {
	Banner,
	Button,
	Dialog,
	Input,
} from '@cloudflare/kumo';
import { EstoriLogo } from '@/brand';
import { pillClass } from '@/components/public-site/primitives';
import { useAuth } from '@/contexts/auth-context';
import { Checkbox } from '@/components/ui/checkbox';
import { TermsAgreementLabel } from './TermsAgreementLabel';
import { PasswordField } from './PasswordField';
import { TERMS_REQUIRED_MESSAGE, TERMS_VERSION } from '@/api-types';
import { apiClient } from '@/lib/api-client';
import { emailError, newPasswordErrors, passwordError } from '@/lib/auth-validation';
import CloudflareLogo from '@/assets/provider-logos/cloudflare.svg?react';
import {
	EnvelopeSimpleIcon,
	WarningCircleIcon,
	XIcon,
} from '@phosphor-icons/react';

const AUTH_PANEL_IMAGE = '/marketing/auth-panel.webp';

const GOOGLE_BUTTON = 'flex h-12 w-full items-center justify-center gap-3 rounded-full bg-[#22252f] text-[15px] font-medium text-white transition-colors hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-public-blue dark:bg-white dark:text-[#22252f] dark:hover:bg-white/90';
const PROVIDER_BUTTON = 'flex h-12 w-full items-center justify-center gap-3 rounded-full text-[15px] font-medium text-kumo-default ring-1 ring-inset ring-kumo-line transition-colors hover:bg-kumo-elevated focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-public-blue';
const TEXT_BUTTON = 'text-kumo-default underline underline-offset-4 transition-colors hover:text-public-blue';

function GoogleLogo() {
	return (
		<svg className="size-5" viewBox="0 0 24 24" aria-hidden>
			<path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
			<path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
			<path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
			<path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
		</svg>
	);
}

function GitHubLogo() {
	return (
		<svg className="size-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
			<path
				fillRule="evenodd"
				clipRule="evenodd"
				d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"
			/>
		</svg>
	);
}

interface LoginModalProps {
	isOpen: boolean;
	onClose: () => void;

	// Original OAuth-only interface (for backward compatibility)
	onLogin: (provider: 'google' | 'github' | 'cloudflare') => void;

	// New enhanced interfaces (optional)
	onEmailLogin?: (credentials: {
		email: string;
		password: string;
	}) => Promise<void>;
	onOAuthLogin?: (
		provider: 'google' | 'github' | 'cloudflare',
		redirectUrl?: string,
	) => void;
	onRegister?: (data: {
		email: string;
		password: string;
		name?: string;
		acceptedTermsVersion: string;
	}) => Promise<void>;
	error?: string | null;
	onClearError?: () => void;

	// Contextual messaging
	actionContext?: string; // e.g., "to star this app", "to fork this project"
	showCloseButton?: boolean;
	/** The view shown each time the window opens. */
	initialMode?: AuthMode;
}

export type AuthMode = 'login' | 'register' | 'forgot';

const RESET_LINK_FAILED_MESSAGE = "Couldn't send the reset link. Try again.";

export function LoginModal({
	isOpen,
	onClose,
	onLogin, // Original OAuth interface
	onEmailLogin,
	onOAuthLogin,
	onRegister,
	error,
	onClearError,
	actionContext,
	showCloseButton = true,
	initialMode = 'login',
}: LoginModalProps) {
	const { authProviders, hasOAuth } = useAuth();
	const [mode, setMode] = useState<AuthMode>(initialMode);
	const [showPassword, setShowPassword] = useState(false);
	const [isLoading, setIsLoading] = useState(false);

	// Forgot-password view: the server's answer once a link is requested, or the request's error.
	const [resetLinkMessage, setResetLinkMessage] = useState<string | null>(null);
	const [forgotError, setForgotError] = useState<string | null>(null);

	// Each opening starts in the requested view; a 401 re-prompt while open keeps the current one.
	const [wasOpen, setWasOpen] = useState(false);
	if (isOpen !== wasOpen) {
		setWasOpen(isOpen);
		if (isOpen) {
			setMode(initialMode);
			setResetLinkMessage(null);
			setForgotError(null);
		}
	}

	// Form state
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [name, setName] = useState('');
	const [confirmPassword, setConfirmPassword] = useState('');
	const [agreeToTerms, setAgreeToTerms] = useState(false);

	// Validation errors
	const [validationErrors, setValidationErrors] = useState<
		Record<string, string>
	>({});

	// Determine if enhanced features are available. Email/password auth is offered
	// whenever the backend reports the email provider is enabled, independently of
	// whether any OAuth provider is also configured.
	const emailAuthEnabled = authProviders?.email ?? true;
	const hasEmailAuth = emailAuthEnabled && !!onEmailLogin;
	const hasRegistration = emailAuthEnabled && !!onRegister;
	const canResetPassword = hasEmailAuth && !!authProviders?.emailSending;
	const showProviders = hasOAuth && mode !== 'forgot';
	const showGitHub = authProviders?.github && showProviders;
	const showGoogle = authProviders?.google && showProviders;
	const showCloudflare = authProviders?.cloudflare && showProviders;

	const resetForm = () => {
		setEmail('');
		setPassword('');
		setName('');
		setConfirmPassword('');
		setAgreeToTerms(false);
		setValidationErrors({});
		setShowPassword(false);
		setResetLinkMessage(null);
		setForgotError(null);
		if (onClearError) onClearError();
	};

	const handleClose = () => {
		resetForm();
		onClose();
	};

	const handleOpenChange = (open: boolean) => {
		if (!open) {
			handleClose();
		}
	};

	const switchMode = (newMode: AuthMode) => {
		setMode(newMode);
		resetForm();
		setValidationErrors({});
		if (onClearError) onClearError();
	};

	// Carries the typed address over, so the reset link goes where the visitor was signing in.
	const openForgotPassword = () => {
		const typedEmail = email;
		switchMode('forgot');
		setEmail(typedEmail);
	};

	const validateForm = (): boolean => {
		const errors: Record<string, string> = {};

		const emailProblem = emailError(email);
		if (emailProblem) errors.email = emailProblem;

		if (mode === 'register') {
			if (!name.trim()) {
				errors.name = 'Name is required';
			} else if (name.trim().length < 2) {
				errors.name = 'Name must be at least 2 characters';
			}

			Object.assign(errors, newPasswordErrors(password, confirmPassword));

			if (!agreeToTerms) {
				errors.terms = TERMS_REQUIRED_MESSAGE;
			}
		} else if (mode === 'login') {
			const passwordProblem = passwordError(password);
			if (passwordProblem) errors.password = passwordProblem;
		}

		setValidationErrors(errors);
		return Object.keys(errors).length === 0;
	};

	const requestResetLink = async () => {
		setForgotError(null);
		try {
			const response = await apiClient.forgotPassword(email.trim());
			if (!response.success || !response.data) {
				throw new Error(response.error?.message || RESET_LINK_FAILED_MESSAGE);
			}
			setResetLinkMessage(response.data.message);
		} catch (err) {
			setForgotError(err instanceof Error && err.message ? err.message : RESET_LINK_FAILED_MESSAGE);
		}
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();

		if (!validateForm()) return;

		setIsLoading(true);
		try {
			if (mode === 'forgot') {
				await requestResetLink();
			} else if (mode === 'login' && onEmailLogin) {
				await onEmailLogin({ email, password });
			} else if (mode === 'register' && onRegister) {
				await onRegister({ email, password, name: name.trim(), acceptedTermsVersion: TERMS_VERSION });
			}
			// Don't auto-close here - let the parent handle success/error
		} catch (err) {
			// Error handling is done in the auth context
		} finally {
			setIsLoading(false);
		}
	};

	const handleOAuthClick = (provider: 'google' | 'github' | 'cloudflare') => {
		// Use the new interface if available, otherwise fall back to original
		if (onOAuthLogin) {
			// Pass the current URL as redirect URL for context preservation
			onOAuthLogin(
				provider,
				window.location.pathname + window.location.search,
			);
		} else {
			onLogin(provider);
		}
	};

	const title =
		mode === 'forgot'
			? 'Reset your password'
			: mode === 'register'
				? 'Create your free account'
				: actionContext
					? `Sign in ${actionContext}`
					: 'Welcome back';

	const description =
		mode === 'forgot'
			? "Enter your account's email and we'll send you a link to choose a new password."
			: mode === 'register'
				? 'Start building your store in minutes. No credit card needed.'
				: actionContext
					? 'Sign in, or create a free account, to continue.'
					: 'Sign in to keep building your stores.';

	const bannerError = mode === 'forgot' ? forgotError : error;

	return (
		<Dialog.Root open={isOpen} onOpenChange={handleOpenChange}>
			<Dialog
				size="xl"
				className="top-1/2 flex max-h-[calc(100svh-2rem)] -translate-y-1/2 p-0 font-public sm:top-1/2 sm:w-[28rem] md:w-[56rem]"
			>
				{/* A photo filling the left column on wider screens */}
				<aside className="relative hidden w-[44%] shrink-0 overflow-hidden md:block">
					<img src={AUTH_PANEL_IMAGE} alt="" className="absolute inset-0 size-full object-cover" />
					<div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
					<div className="absolute inset-x-0 bottom-0 p-8 text-white">
						<p className="text-2xl leading-snug font-normal tracking-[-0.01em] text-balance">From first idea to first order.</p>
						<p className="mt-2 text-sm text-white/80">Build your store with AI, launch it, and start selling.</p>
					</div>
				</aside>

				<div className="relative min-w-0 flex-1 overflow-y-auto px-6 py-8 sm:px-10">
					{showCloseButton && (
						<Dialog.Close
							aria-label="Close dialog"
							render={(props) => (
								<Button
									{...props}
									className="absolute right-4 top-4"
									title="Close dialog"
									icon={XIcon}
									variant="ghost"
									shape="square"
								/>
							)}
						/>
					)}

					<EstoriLogo className="h-7 w-auto text-public-brand dark:text-white" />
					<Dialog.Title className="mt-6 text-[28px] leading-tight font-normal tracking-[-0.02em] text-kumo-default">
						{title}
					</Dialog.Title>
					<Dialog.Description className="mt-2 text-[15px] text-kumo-subtle">
						{description}
					</Dialog.Description>

					{bannerError && (
						<div className="mt-6">
							<Banner
								variant="error"
								icon={<WarningCircleIcon />}
								title={bannerError}
							/>
						</div>
					)}

					{showProviders && (
						<div className="mt-6 grid gap-3">
							{showGoogle && (
								<button type="button" onClick={() => handleOAuthClick('google')} className={GOOGLE_BUTTON}>
									<GoogleLogo />
									Continue with Google
								</button>
							)}
							{showGitHub && (
								<button type="button" onClick={() => handleOAuthClick('github')} className={PROVIDER_BUTTON}>
									<GitHubLogo />
									Continue with GitHub
								</button>
							)}
							{showCloudflare && (
								<button type="button" onClick={() => handleOAuthClick('cloudflare')} className={PROVIDER_BUTTON}>
									<CloudflareLogo className="size-5" aria-hidden />
									Continue with Cloudflare
								</button>
							)}
						</div>
					)}

					{/* Divider, when both providers and email are offered */}
					{hasEmailAuth && showProviders && (
						<div className="my-5 flex items-center gap-3 text-xs text-kumo-subtle">
							<span className="h-px flex-1 bg-kumo-line" />
							or
							<span className="h-px flex-1 bg-kumo-line" />
						</div>
					)}

					<div className={showProviders && hasEmailAuth ? undefined : 'mt-6'}>
						{/* Reset link requested: the server's answer replaces the form */}
						{mode === 'forgot' && resetLinkMessage && (
							<div className="grid gap-4">
								<Banner
									variant="default"
									icon={<EnvelopeSimpleIcon />}
									description={resetLinkMessage}
								/>
								<button type="button" onClick={() => switchMode('login')} className={PROVIDER_BUTTON}>
									Back to sign in
								</button>
							</div>
						)}

						{/* Email and password */}
						{hasEmailAuth && !(mode === 'forgot' && resetLinkMessage) && (
							<form
								onSubmit={handleSubmit}
								className="flex w-full flex-col gap-3"
							>
								{mode === 'register' && (
									<div className="w-full min-w-0 [&_input]:w-full [&_[data-slot=field]]:gap-1.5">
										<Input
											label="Full name"
											type="text"
											placeholder="Full name"
											value={name}
											onChange={(e) =>
												setName(e.target.value)
											}
											error={validationErrors.name}
											disabled={isLoading}
											autoComplete="name"
											className="w-full"
										/>
									</div>
								)}

								<div className="w-full min-w-0 [&_input]:w-full [&_[data-slot=field]]:gap-1.5">
									<Input
										label="Email address"
										type="email"
										placeholder="Email address"
										value={email}
										onChange={(e) => setEmail(e.target.value)}
										error={validationErrors.email}
										disabled={isLoading}
										autoComplete="email"
										className="w-full"
									/>
								</div>

								{mode !== 'forgot' && (
									<PasswordField
										label="Password"
										value={password}
										onChange={setPassword}
										error={validationErrors.password}
										disabled={isLoading}
										autoComplete={
											mode === 'register'
												? 'new-password'
												: 'current-password'
										}
										visible={showPassword}
										onVisibleChange={setShowPassword}
									/>
								)}

								{mode === 'login' && canResetPassword && (
									<div className="-mt-1 flex justify-end">
										<button
											type="button"
											onClick={openForgotPassword}
											disabled={isLoading}
											className="text-sm text-kumo-subtle hover:text-kumo-default transition-colors"
										>
											Forgot password?
										</button>
									</div>
								)}

								{mode === 'register' && (
									<div className="w-full min-w-0 [&_input]:w-full [&_[data-slot=field]]:gap-1.5">
										<Input
											label="Confirm password"
											type="password"
											placeholder="Confirm password"
											value={confirmPassword}
											onChange={(e) =>
												setConfirmPassword(e.target.value)
											}
											error={validationErrors.confirmPassword}
											disabled={isLoading}
											autoComplete="new-password"
											className="w-full"
										/>
									</div>
								)}

								{mode === 'register' && (
									<div className="grid gap-1">
										<label className="flex items-start gap-2 text-sm text-kumo-default">
											<Checkbox
												checked={agreeToTerms}
												onCheckedChange={(checked) => setAgreeToTerms(checked === true)}
												disabled={isLoading}
												className="mt-0.5"
											/>
											<TermsAgreementLabel />
										</label>
										{validationErrors.terms && <p className="text-xs text-kumo-danger">{validationErrors.terms}</p>}
									</div>
								)}

								<button
									type="submit"
									disabled={isLoading}
									className={pillClass('blue', 'mt-2 h-12 w-full text-[15px] font-medium disabled:cursor-wait disabled:opacity-70')}
								>
									{isLoading
										? mode === 'register'
											? 'Creating account...'
											: mode === 'forgot'
												? 'Sending...'
												: 'Signing in...'
										: mode === 'register'
											? 'Create account'
											: mode === 'forgot'
												? 'Send reset link'
												: 'Sign in'}
								</button>
							</form>
						)}
					</div>

					{/* Footer */}
					{mode === 'forgot' && !resetLinkMessage && (
						<p className="mt-6 text-center text-sm">
							<button type="button" onClick={() => switchMode('login')} className={TEXT_BUTTON}>
								Back to sign in
							</button>
						</p>
					)}

					{/* Switching between sign-in and sign-up, when registration is available */}
					{mode !== 'forgot' && hasRegistration && hasEmailAuth && (
						<p className="mt-6 text-center text-sm text-kumo-subtle">
							{mode === 'login' ? 'New to Estori? ' : 'Already have an account? '}
							<button
								type="button"
								onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}
								className={TEXT_BUTTON}
							>
								{mode === 'login' ? 'Create an account' : 'Sign in'}
							</button>
						</p>
					)}
				</div>
			</Dialog>
		</Dialog.Root>
	);
}
