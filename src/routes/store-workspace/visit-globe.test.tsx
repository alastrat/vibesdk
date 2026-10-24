import { act, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { StoreTrafficEvent } from '@/api-types';
import {
	mountElement,
	silenceTestRendererDeprecation,
	unmountAll,
} from '@/test-support/mounted';
import { VisitGlobe } from './visit-globe';
import { getVisitCountries, projectVisitPoint } from './visit-globe-utils';

beforeAll(silenceTestRendererDeprecation);
afterEach(unmountAll);
const event = (id: string, country: string): StoreTrafficEvent => ({
	id,
	country,
	kind: 'page_view',
	path: '/',
	device: 'desktop',
	source: 'Direct',
	createdAt: '2026-10-24T12:00:00Z',
});

describe('visitor globe geography', () => {
	it('places a focused country at the center and hides the opposite hemisphere', () => {
		const center = projectVisitPoint(4, -73, {
			latitude: 4,
			longitude: -73,
		});
		expect(center.x).toBeCloseTo(0);
		expect(center.y).toBeCloseTo(0);
		expect(center.depth).toBeCloseTo(1);
		const opposite = projectVisitPoint(-4, 107, {
			latitude: 4,
			longitude: -73,
		});
		expect(opposite.depth).toBeCloseTo(-1);
		const east = projectVisitPoint(0, 90, { latitude: 0, longitude: 0 });
		expect(east.x).toBeCloseTo(1);
		const north = projectVisitPoint(90, 0, { latitude: 0, longitude: 0 });
		expect(north.y).toBeCloseTo(-1);
	});

	it('maps only observed countries without adding recent events to aggregate views', () => {
		const countries = getVisitCountries(
			[
				event('co-1', 'co'),
				event('co-1', 'CO'),
				event('de-1', 'DE'),
				event('unknown', 'XX'),
			],
			[
				{ name: 'CO', views: 12, visitors: 4 },
				{ name: 'BR', views: 0, visitors: 0 },
				{ name: 'US', views: NaN, visitors: 0 },
			],
		);
		expect(countries.map(({ code }) => code)).toEqual(['CO', 'DE']);
		expect(countries[0]).toMatchObject({
			code: 'CO',
			views: 12,
			recentEvents: 1,
		});
		expect(countries[1]).toMatchObject({
			code: 'DE',
			views: 1,
			recentEvents: 1,
			latitude: 51,
			longitude: 10,
		});
	});

	it('retains an observed country with no map coordinates instead of inventing a location', () => {
		const countries = getVisitCountries(
			[],
			[{ name: 'BQ', views: 2, visitors: 1 }],
		);
		expect(countries).toHaveLength(1);
		expect(countries[0]).toMatchObject({ code: 'BQ', views: 2 });
		expect(countries[0].latitude).toBeUndefined();
		expect(countries[0].longitude).toBeUndefined();
	});
});

describe('visitor globe controls', () => {
	it('selects and clears actual countries with pointer and keyboard and follows external selection', async () => {
		const events = [event('co', 'CO'), event('us', 'US')];
		function Harness() {
			const [activeCountry, onSelectCountry] = useState<string | null>(
				null,
			);
			return (
				<VisitGlobe
					events={events}
					countries={[]}
					activeCountry={activeCountry}
					onSelectCountry={onSelectCountry}
				/>
			);
		}
		const renderer = await mountElement(<Harness />);
		const marker = (code: string) =>
			renderer.root
				.findAllByType('g')
				.find((node) => node.props['data-country'] === code)!;
		expect(marker('CO').props['aria-pressed']).toBe(false);
		await act(async () => marker('US').props.onClick());
		expect(marker('US').props['aria-pressed']).toBe(true);
		expect(marker('US').props.transform).toBe('translate(180 180)');
		await act(async () =>
			marker('CO').props.onKeyDown({ key: 'Enter', preventDefault() {} }),
		);
		expect(marker('CO').props['aria-pressed']).toBe(true);
		await act(async () =>
			marker('CO').props.onKeyDown({ key: ' ', preventDefault() {} }),
		);
		expect(marker('CO').props['aria-pressed']).toBe(false);
	});

	it('removes back-facing country controls and follows a country chosen outside the globe', async () => {
		const props = {
			events: [event('co', 'CO'), event('jp', 'JP')],
			countries: [],
			onSelectCountry: () => {},
		};
		const renderer = await mountElement(
			<VisitGlobe {...props} activeCountry="CO" />,
		);
		const visible = () =>
			renderer.root
				.findAllByType('g')
				.filter((node) => node.props['data-country'])
				.map((node) => node.props['data-country']);
		expect(visible()).toEqual(['CO']);
		await act(async () =>
			renderer.update(<VisitGlobe {...props} activeCountry="JP" />),
		);
		expect(visible()).toEqual(['JP']);
		expect(
			renderer.root
				.findAllByType('g')
				.find((node) => node.props['data-country'] === 'JP')!.props[
				'aria-pressed'
			],
		).toBe(true);
	});

	it('exposes an accessible expansion control without creating any visits for empty data', () => {
		const html = renderToStaticMarkup(
			<VisitGlobe
				events={[]}
				countries={[]}
				onSelectCountry={() => {}}
			/>,
		);
		expect(html).toContain('Explore visitor locations');
		expect(html).not.toContain('data-country=');
		expect(html).not.toContain('NaN');
	});
});
