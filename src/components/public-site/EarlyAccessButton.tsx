import { useLocation } from 'react-router';
import { toast } from 'sonner';
import type { EarlyAccessCapability } from '@/api-types';
import { EARLY_ACCESS_CONFIRMATION, useMyEarlyAccess, useRequestEarlyAccess } from '@/hooks/use-early-access';
import { useAuthGuard } from '@/hooks/useAuthGuard';
import { earlyAccessReturnUrl } from '@/lib/early-access';
import { msg } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { pillClass, type PillVariant } from './primitives';

/**
 * Requests early access to a program. Signed in, it records at once. Signed out, it opens sign-in with a return URL
 * that carries the request, and useEarlyAccessFromUrl records it there: one carrier, so every sign-in method records
 * it exactly once.
 */
export function EarlyAccessButton({
	capability,
	variant = 'blue',
	className,
	listedClassName,
}: {
	capability: EarlyAccessCapability;
	variant?: PillVariant;
	className?: string;
	/** Text color of "You're on the list", to match the background. */
	listedClassName?: string;
}) {
	const { pathname } = useLocation();
	const { isAuthenticated, user, requireAuth } = useAuthGuard();
	const mine = useMyEarlyAccess();
	const { mutate, isPending } = useRequestEarlyAccess();

	if (mine.data?.capabilities.includes(capability)) {
		return (
			<p role="status" className={cn('inline-flex items-center px-2 text-base', listedClassName)}>
				You're on the list
			</p>
		);
	}

	const record = () =>
		mutate(capability, {
			onSuccess: () => toast.success(EARLY_ACCESS_CONFIRMATION),
			onError: (error) => toast.error(error.message),
		});

	return (
		<button
			type="button"
			disabled={isPending}
			className={pillClass(variant, className)}
			onClick={() => {
				if (isAuthenticated && !user?.isAnonymous) {
					record();
					return;
				}
				requireAuth({
					requireFullAuth: true,
					actionContext: msg('Sign in to request early access'),
					intendedUrl: earlyAccessReturnUrl(pathname, capability),
				});
			}}
		>
			{isPending ? 'Saving…' : 'Request early access'}
		</button>
	);
}
