import { t } from '@/lib/i18n';
import { marketingCopy } from '@/content/marketing-copy';
import type { ReactNode } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { PillLink, type PillVariant } from './primitives';

/** "Start building free": the sign-up page for new visitors, and the builder for people already signed in. */
export function StartBuildingButton({
	variant = 'blue',
	className,
	children = marketingCopy.common.startBuildingFree,
}: {
	variant?: PillVariant;
	className?: string;
	children?: ReactNode;
}) {
	const { isAuthenticated } = useAuth();
	return (
		<PillLink to={isAuthenticated ? '/' : '/signup'} variant={variant} className={className}>
			{typeof children === 'string' ? t(children) : children}
		</PillLink>
	);
}
