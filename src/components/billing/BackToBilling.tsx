import { Link } from 'react-router';
import { buttonVariants } from '@cloudflare/kumo';
import { ArrowLeftIcon } from '@phosphor-icons/react';
import { BILLING_PATH } from '@/api-types';
import { t } from '@/lib/i18n';

/** Leaves a payment page for the billing page without paying. */
export function BackToBilling() {
	return (
		<Link to={BILLING_PATH} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
			<ArrowLeftIcon className="size-4" aria-hidden />
			{t('Back to billing')}
		</Link>
	);
}
