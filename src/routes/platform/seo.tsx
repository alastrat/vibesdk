import { SolutionCopyPage } from '@/components/public-site/SolutionCopyPage';
import { SEARCH_OPTIMIZATION_PAGE } from '@/content/public-pages';
import { SEARCH_OPTIMIZATION_COPY } from '@/content/solution-pages';

export default function SearchOptimizationPage() {
	return <SolutionCopyPage head={SEARCH_OPTIMIZATION_PAGE} copy={SEARCH_OPTIMIZATION_COPY} />;
}
