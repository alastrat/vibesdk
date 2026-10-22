import { SolutionLandingPage } from '@/components/public-site/SolutionLandingPage';
import { PageMeta } from '@/components/public-site/solution-page';
import { DIGITAL_PAGE } from '@/content/public-pages';

export default function DigitalPage() {
	return (
		<>
			<PageMeta {...DIGITAL_PAGE} />
			<SolutionLandingPage id="digital" />
		</>
	);
}
