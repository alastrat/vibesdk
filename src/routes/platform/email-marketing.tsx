import { SolutionCopyPage } from '@/components/public-site/SolutionCopyPage';
import { EMAIL_MARKETING_PAGE } from '@/content/public-pages';
import { EMAIL_MARKETING_COPY } from '@/content/solution-pages';

export default function EmailMarketingPage() {
	return <SolutionCopyPage head={EMAIL_MARKETING_PAGE} copy={EMAIL_MARKETING_COPY} />;
}
