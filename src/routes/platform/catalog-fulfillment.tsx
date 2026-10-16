import { SolutionCopyPage } from '@/components/public-site/SolutionCopyPage';
import { CATALOG_FULFILLMENT_PAGE } from '@/content/public-pages';
import { CATALOG_FULFILLMENT_COPY } from '@/content/solution-pages';

export default function CatalogFulfillmentPage() {
	return <SolutionCopyPage head={CATALOG_FULFILLMENT_PAGE} copy={CATALOG_FULFILLMENT_COPY} />;
}
