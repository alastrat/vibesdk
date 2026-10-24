import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
vi.mock('@/hooks/use-apps', () => ({ useApps: () => ({ apps: [] }) }));
import { AnalyticsToolbar } from './analytics-toolbar';
describe('analytics toolbar accessibility', () => {
	it('announces the selected dates in the date control name', () => {
		const html = renderToStaticMarkup(
			<MemoryRouter>
				<AnalyticsToolbar
					appId="a"
					appTitle="A"
					userId="owner"
					mode="test"
					period={{
						preset: 'custom',
						days: 2,
						from: '2026-10-22',
						to: '2026-10-23',
					}}
					productId=""
					products={[]}
					compare
					hiddenWidgets={[]}
					report={null}
				/>
			</MemoryRouter>,
		);
		expect(html).toContain(
			'aria-label="Choose dates: Oct 22, 2026 – Oct 23, 2026"',
		);
	});
});
