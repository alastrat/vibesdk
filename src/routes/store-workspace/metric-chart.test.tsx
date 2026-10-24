import { act, type ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
	mountElement,
	silenceTestRendererDeprecation,
	textOf,
	unmountAll,
} from '@/test-support/mounted';
import { MetricChart } from './metric-chart';

// ResizeObserver measures a DOM element; the Workers renderer has no DOM.
// Keep the chart, scales, SVG paths, and all interaction state real.
vi.mock('@visx/responsive', () => ({
	ParentSize: ({
		children,
	}: {
		children: (size: { width: number; height: number }) => ReactNode;
	}) => children({ width: 360, height: 280 }),
}));

beforeAll(silenceTestRendererDeprecation);
afterEach(unmountAll);
const formatValue = (value: number) => `$${value.toFixed(2)}`;

describe('daily metric chart', () => {
	it('exposes each UTC day and its comparable prior day through keyboard navigation', async () => {
		const renderer = await mountElement(
			<MetricChart
				label="Revenue"
				formatValue={formatValue}
				points={[
					{ date: '2026-03-08', value: 20 },
					{ date: '2026-03-09', value: 40 },
					{ date: '2026-03-10', value: 10 },
				]}
				previous={[
					{ date: '2026-03-05', value: 12 },
					{ date: '2026-03-06', value: 18 },
					{ date: '2026-03-07', value: 5 },
				]}
			/>,
		);
		const slider = () => renderer.root.findByProps({ role: 'slider' });
		await act(async () => slider().props.onFocus());
		expect(slider().props['aria-valuetext']).toContain('Mar 10, 2026');
		expect(slider().props['aria-valuetext']).toContain('$10.00');
		expect(slider().props['aria-valuetext']).toContain('Mar 7, 2026');
		await act(async () =>
			slider().props.onKeyDown({ key: 'ArrowLeft', preventDefault() {} }),
		);
		expect(slider().props['aria-valuetext']).toContain('Mar 9, 2026');
		expect(slider().props['aria-valuetext']).toContain('$18.00');
		await act(async () =>
			slider().props.onKeyDown({ key: 'Home', preventDefault() {} }),
		);
		await act(async () =>
			slider().props.onKeyDown({ key: 'ArrowLeft', preventDefault() {} }),
		);
		expect(slider().props['aria-valuenow']).toBe(0);
		expect(textOf(renderer)).toContain('$20.00');
		await act(async () =>
			slider().props.onKeyDown({ key: 'End', preventDefault() {} }),
		);
		await act(async () =>
			slider().props.onKeyDown({
				key: 'ArrowRight',
				preventDefault() {},
			}),
		);
		expect(slider().props['aria-valuenow']).toBe(2);
	});

	it('does not shift a missing comparison day onto a different calendar day', async () => {
		const renderer = await mountElement(
			<MetricChart
				label="Revenue"
				formatValue={formatValue}
				points={[
					{ date: '2026-04-04', value: 1 },
					{ date: '2026-04-05', value: 2 },
					{ date: '2026-04-06', value: 3 },
				]}
				previous={[
					{ date: '2026-04-01', value: 9 },
					{ date: '2026-04-03', value: 7 },
				]}
			/>,
		);
		const slider = () => renderer.root.findByProps({ role: 'slider' });
		await act(async () =>
			slider().props.onKeyDown({ key: 'Home', preventDefault() {} }),
		);
		await act(async () =>
			slider().props.onKeyDown({
				key: 'ArrowRight',
				preventDefault() {},
			}),
		);
		expect(slider().props['aria-valuetext']).toContain('Apr 5, 2026');
		expect(slider().props['aria-valuetext']).not.toContain('$7.00');
	});

	it('renders a finite, visible single-day point and accepts zero and negative metrics', async () => {
		for (const value of [0, -4]) {
			const renderer = await mountElement(
				<MetricChart
					label="Net"
					formatValue={formatValue}
					points={[{ date: '2026-10-24', value }]}
				/>,
			);
			const slider = renderer.root.findByProps({ role: 'slider' });
			expect(slider.props['aria-valuemax']).toBe(0);
			expect(slider.props['aria-valuetext']).toContain(
				formatValue(value),
			);
			const dots = renderer.root.findAllByType('circle');
			expect(
				dots.some(
					(dot) =>
						Number.isFinite(dot.props.cx) &&
						Number.isFinite(dot.props.cy),
				),
			).toBe(true);
			expect(JSON.stringify(renderer.toJSON())).not.toMatch(
				/NaN|Infinity/,
			);
		}
	});

	it('places a rounded count label at its actual integer value', async () => {
		const renderer = await mountElement(
			<MetricChart
				label="Checkouts"
				formatValue={(value) => value.toFixed(0)}
				points={[{ date: '2026-10-24', value: 1 }]}
			/>,
		);
		const one = renderer.root
			.findAllByType('text')
			.find((node) => node.children.join('') === '1')!;
		const dot = renderer.root.findAllByType('circle')[0];
		expect(one.props.y).toBe(dot.props.cy);
	});

	it('shows an honest empty state without a keyboard target for nonexistent points', async () => {
		const renderer = await mountElement(
			<MetricChart
				label="Revenue"
				formatValue={formatValue}
				points={[]}
			/>,
		);
		expect(textOf(renderer)).toContain('No data for this period.');
		expect(renderer.root.findAllByProps({ role: 'slider' })).toHaveLength(
			0,
		);
	});

	it('shows both observations when comparing two single-day periods', async () => {
		const renderer = await mountElement(
			<MetricChart
				label="Revenue"
				formatValue={formatValue}
				points={[{ date: '2026-10-24', value: 10 }]}
				previous={[{ date: '2026-10-23', value: 20 }]}
			/>,
		);
		const dots = renderer.root.findAllByType('circle');
		expect(dots).toHaveLength(2);
		expect(dots[0].props.cy).not.toBe(dots[1].props.cy);
	});

	it('selects the nearest observation under a resized pointer coordinate', async () => {
		const renderer = await mountElement(
			<MetricChart
				label="Revenue"
				formatValue={formatValue}
				points={[
					{ date: '2026-10-22', value: 10 },
					{ date: '2026-10-23', value: 20 },
					{ date: '2026-10-24', value: 30 },
				]}
			/>,
		);
		const slider = () => renderer.root.findByProps({ role: 'slider' });
		const target = {
			getBoundingClientRect: () => ({ left: 100, width: 720 }),
		};
		await act(async () =>
			slider().props.onPointerMove({
				clientX: 110,
				currentTarget: target,
			}),
		);
		expect(slider().props['aria-valuetext']).toContain('Oct 22, 2026');
		await act(async () =>
			slider().props.onPointerMove({
				clientX: 396,
				currentTarget: target,
			}),
		);
		expect(slider().props['aria-valuetext']).toContain('Oct 23, 2026');
		await act(async () =>
			slider().props.onPointerMove({
				clientX: 1000,
				currentTarget: target,
			}),
		);
		expect(slider().props['aria-valuetext']).toContain('Oct 24, 2026');
	});
});
