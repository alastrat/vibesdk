/**
 * The sign-in window: the sign-in photo filling the left column on wider screens, and the sign-in form on the right.
 * Signing up happens on its own page, which "Create an account" opens.
 */

import { useState } from 'react';
import { Button, Dialog } from '@cloudflare/kumo';
import { XIcon } from '@phosphor-icons/react';
import { useI18n } from '@/lib/i18n';
import { AuthForm, authCopy, type OAuthProvider, type SignInView } from './AuthForm';
import { AuthPhoto } from './AuthPhoto';
import { LanguagePicker } from './LanguagePicker';

interface LoginModalProps {
	isOpen: boolean;
	onClose: () => void;
	onOAuthLogin: (provider: OAuthProvider, redirectUrl?: string) => void;
	/** Leaves the window for the sign-up page. */
	onCreateAccount: () => void;
	/** Why sign-in was asked for, as a whole sentence marked with `msg`, e.g. `msg('Sign in to star this app')`. */
	actionContext?: string;
	showCloseButton?: boolean;
	/** The view shown each time the window opens. */
	initialMode?: SignInView;
}

export function LoginModal({
	isOpen,
	onClose,
	onOAuthLogin,
	onCreateAccount,
	actionContext,
	showCloseButton = true,
	initialMode = 'login',
}: LoginModalProps) {
	const { t } = useI18n();
	const [mode, setMode] = useState<SignInView>(initialMode);
	// Each opening starts in the requested view with an empty form; a 401 re-prompt while open keeps the current one.
	const [openings, setOpenings] = useState(0);
	const [wasOpen, setWasOpen] = useState(false);
	if (isOpen !== wasOpen) {
		setWasOpen(isOpen);
		if (isOpen) {
			setMode(initialMode);
			setOpenings((count) => count + 1);
		}
	}

	const { title, description } = authCopy(mode, actionContext);

	return (
		<Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
			<Dialog
				size="xl"
				className="auth-dialog top-1/2 flex max-h-[calc(100svh-2rem)] -translate-y-1/2 p-0 font-public sm:top-1/2 sm:w-[28rem] md:min-h-[36rem] md:w-[56rem]"
			>
				<AuthPhoto view="login" className="hidden w-[44%] shrink-0 md:block" />

				<div className="relative flex min-w-0 flex-1 flex-col overflow-y-auto px-6 py-8 sm:px-10">
					{showCloseButton && (
						<Dialog.Close
							aria-label={t('Close dialog')}
							render={(props) => (
								<Button {...props} className="absolute right-4 top-4" title={t('Close dialog')} icon={XIcon} variant="ghost" shape="square" />
							)}
						/>
					)}

					<div>
						<LanguagePicker />
					</div>

					{/* Centred, so the shorter reset view sits in the middle of the window */}
					<div className="my-auto">
						<Dialog.Title className="text-[28px] leading-tight font-normal tracking-[-0.02em] text-kumo-default">{title}</Dialog.Title>
						<Dialog.Description className="mt-2 text-[15px] text-kumo-subtle">{description}</Dialog.Description>
						<AuthForm
							key={openings}
							mode={mode}
							onModeChange={(next) => next !== 'register' && setMode(next)}
							onOAuthLogin={(provider) => onOAuthLogin(provider, window.location.pathname + window.location.search)}
							onCreateAccount={onCreateAccount}
						/>
					</div>
				</div>
			</Dialog>
		</Dialog.Root>
	);
}
