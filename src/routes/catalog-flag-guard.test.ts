import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/src/components/layout/app-sidebar.tsx', '/src/routes/catalog/index.tsx'], { query: '?raw', import: 'default', eager: true });

describe('the catalog pause in the app', () => {
	it('hides both catalog links in the sidebar while the catalog is paused', () => {
		const sidebar = sources['/src/components/layout/app-sidebar.tsx'] ?? '';
		expect(sidebar).toContain("const catalogPaused = useFlag('catalog-paused');");
		expect(sidebar.match(/\{user && !catalogPaused && \(/g)?.length).toBe(2);
	});

	it('shows the catalog page as paused, saying catalog products can\'t be bought either, as checkout refuses them', () => {
		const page = sources['/src/routes/catalog/index.tsx'] ?? '';
		expect(page).toContain("useFlag('catalog-paused')");
		expect(page).toContain('title="The catalog is paused"');
		expect(page).toContain(`description="Catalog products can't be added to stores or bought right now. Orders already paid for still ship."`);
	});
});
