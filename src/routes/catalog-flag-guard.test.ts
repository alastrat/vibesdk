import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/src/components/layout/app-sidebar.tsx', '/src/routes/catalog/index.tsx'], { query: '?raw', import: 'default', eager: true });

describe('the catalog pause in the app', () => {
	it('gates the shared expanded and collapsed catalog link', () => {
		const sidebar = sources['/src/components/layout/app-sidebar.tsx'] ?? '';
		expect(sidebar).toContain("const catalogPaused = useFlag('catalog-paused');");
		expect(sidebar).toContain("!catalogPaused && item(t('Catalog'), '/catalog'");
	});

	it('shows the catalog page as paused, saying catalog products can\'t be bought either, as checkout refuses them', () => {
		const page = sources['/src/routes/catalog/index.tsx'] ?? '';
		expect(page).toContain("useFlag('catalog-paused')");
		expect(page).toMatch(/title=\{t\(['"]The catalog is paused['"]\)\}/);
		expect(page).toContain("Catalog products can't be added to stores or bought right now. Orders already paid for still ship.");
	});
});
