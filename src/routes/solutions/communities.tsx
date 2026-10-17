import { SolutionCopyPage } from '@/components/public-site/SolutionCopyPage';
import { COMMUNITIES_PAGE } from '@/content/public-pages';
import { COMMUNITIES_COPY } from '@/content/solution-pages';

export default function CommunitiesPage() {
	return <SolutionCopyPage head={COMMUNITIES_PAGE} copy={COMMUNITIES_COPY} />;
}
