import { SolutionLandingPage } from '@/components/public-site/SolutionLandingPage';
import { PageMeta } from '@/components/public-site/solution-page';
import { BRANDS_PAGE } from '@/content/public-pages';

export default function BrandsPage() {
	return (
		<>
			<PageMeta {...BRANDS_PAGE} />
			<SolutionLandingPage id="brands" />
		</>
	);
}
