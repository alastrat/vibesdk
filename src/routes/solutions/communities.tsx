import { SolutionLandingPage } from '@/components/public-site/SolutionLandingPage';
import { PageMeta } from '@/components/public-site/solution-page';
import { COMMUNITIES_PAGE } from '@/content/public-pages';

export default function CommunitiesPage() {
	return (
		<>
			<PageMeta {...COMMUNITIES_PAGE} />
			<SolutionLandingPage id="communities" />
		</>
	);
}
