import { describe, expect, it } from 'vitest';
import { SUPPLIER_NAMES } from '../copy-rules';

const sources = import.meta.glob<string>(['/src/routes/catalog/index.tsx', '/src/routes.tsx', '/src/components/layout/app-sidebar.tsx'], { query: '?raw', import: 'default', eager: true });

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('the Catalog page', () => {
	it('is a signed-in page linked from the sidebar', () => {
		const routes = source('/src/routes.tsx');
		expect(routes).toContain("path: 'catalog'");
		expect(routes.slice(routes.indexOf("path: 'catalog'"), routes.indexOf("path: 'catalog'") + 200)).toContain('protectedPage(CatalogPage)');
		expect(source('/src/components/layout/app-sidebar.tsx')).toContain("'/catalog'");
	});

	it("shows the seller's cost and price floor, never a supplier name or SKU", () => {
		const page = source('/src/routes/catalog/index.tsx');
		for (const label of ['Your cost', 'Lowest price', 'Suggested price', 'Start a store with this']) expect(page).toContain(label);
		for (const name of SUPPLIER_NAMES) expect(page.toLowerCase()).not.toContain(name);
		expect(page.toLowerCase()).not.toContain('sku');

	});
});
