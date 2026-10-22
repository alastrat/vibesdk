import { SolutionLandingPage } from '@/components/public-site/SolutionLandingPage';
import { PageMeta } from '@/components/public-site/solution-page';
import { RESELLERS_PAGE } from '@/content/public-pages';

export default function ResellersPage() {
	return (
		<>
			<PageMeta {...RESELLERS_PAGE} />
			<SolutionLandingPage id="resellers" />
		</>
	);
}
