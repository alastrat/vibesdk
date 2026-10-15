import type { ReactNode } from 'react';
import { useAuthModal } from '@/components/auth/AuthModalProvider';
import { useAuth } from '@/contexts/auth-context';
import { PillLink, pillClass, type PillVariant } from './primitives';

/**
 * "Start building free": opens the sign-up window for new visitors, and goes to the builder for people already signed
 * in. `onOpen` runs before the window opens, for example to close the phone menu.
 */
export function StartBuildingButton({
	variant = 'blue',
	className,
	onOpen,
	children = 'Start building free',
}: {
	variant?: PillVariant;
	className?: string;
	onOpen?: () => void;
	children?: ReactNode;
}) {
	const { isAuthenticated } = useAuth();
	const { showAuthModal } = useAuthModal();
	if (isAuthenticated) {
		return (
			<PillLink to="/" variant={variant} className={className}>
				{children}
			</PillLink>
		);
	}
	return (
		<button
			type="button"
			onClick={() => {
				onOpen?.();
				showAuthModal(undefined, undefined, undefined, { initialMode: 'register' });
			}}
			className={pillClass(variant, className)}
		>
			{children}
		</button>
	);
}
