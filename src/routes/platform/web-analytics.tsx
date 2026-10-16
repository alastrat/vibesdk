import { SolutionCopyPage } from '@/components/public-site/SolutionCopyPage';
import { WEB_ANALYTICS_PAGE } from '@/content/public-pages';
import { WEB_ANALYTICS_COPY } from '@/content/solution-pages';

export default function WebAnalyticsPage() {
	return <SolutionCopyPage head={WEB_ANALYTICS_PAGE} copy={WEB_ANALYTICS_COPY} />;
}
