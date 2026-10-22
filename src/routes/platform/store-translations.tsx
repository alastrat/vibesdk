import { SolutionCopyPage } from '@/components/public-site/SolutionCopyPage';
import { marketingCopy } from '@/content/marketing-copy';
import { STORE_TRANSLATIONS_PAGE } from '@/content/public-pages';
import type { SolutionCopy } from '@/content/solution-pages';

const COPY: SolutionCopy = { capability: 'store-translations', ...marketingCopy.platform.storeTranslations };

export default function StoreTranslationsPage() {
	return <SolutionCopyPage head={STORE_TRANSLATIONS_PAGE} copy={COPY} />;
}
