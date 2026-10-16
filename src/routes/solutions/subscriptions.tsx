import { SolutionCopyPage } from '@/components/public-site/SolutionCopyPage';
import { SUBSCRIPTIONS_PAGE } from '@/content/public-pages';
import { SUBSCRIPTIONS_COPY } from '@/content/solution-pages';

export default function SubscriptionsPage() {
	return <SolutionCopyPage head={SUBSCRIPTIONS_PAGE} copy={SUBSCRIPTIONS_COPY} />;
}
