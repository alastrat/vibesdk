import { SolutionLandingPage } from '@/components/public-site/SolutionLandingPage';
import { PageMeta } from '@/components/public-site/solution-page';
import { SUBSCRIPTIONS_PAGE } from '@/content/public-pages';

export default function SubscriptionsPage() {
	return (
		<>
			<PageMeta {...SUBSCRIPTIONS_PAGE} />
			<SolutionLandingPage id="subscriptions" />
		</>
	);
}
