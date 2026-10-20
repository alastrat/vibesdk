import { describe, expect, it } from 'vitest';
import type { CaptureResult } from 'posthog-js';
import { globalPrivacyControl, posthogInitOptions, replayPausedOn, stripUrlQueries, withoutQuery } from './posthog-options';

describe('posthog-js options', () => {
	it('talks to /ingest, records layouts and clicks but no page text, input values, images or iframes, and asks PostHog for no flags', () => {
		expect(posthogInitOptions({ gpc: false, optedOut: false, replay: true })).toEqual({
			api_host: '/ingest',
			ui_host: 'https://us.posthog.com',
			person_profiles: 'identified_only',
			capture_pageview: 'history_change',
			capture_pageleave: 'if_capture_pageview',
			autocapture: true,
			mask_all_text: true,
			mask_all_element_attributes: true,
			capture_exceptions: true,
			advanced_disable_feature_flags: true,
			disable_surveys: true,
			disable_session_recording: false,
			enable_recording_console_log: false,
			session_recording: { maskAllInputs: true, maskTextSelector: '*', blockSelector: 'img, iframe', recordHeaders: false, recordBody: false },
			before_send: stripUrlQueries,
			opt_out_capturing_by_default: false,
		});
	});

	it('starts opted out under GPC or the account setting, and without replay when it is paused', () => {
		expect(posthogInitOptions({ gpc: true, optedOut: false, replay: true }).opt_out_capturing_by_default).toBe(true);
		expect(posthogInitOptions({ gpc: false, optedOut: true, replay: true }).opt_out_capturing_by_default).toBe(true);
		expect(posthogInitOptions({ gpc: false, optedOut: false, replay: false }).disable_session_recording).toBe(true);
	});

	it('pauses replay on orders, emails, profile and payments setup, settings and billing, and admin pages only', () => {
		for (const path of ['/orders', '/orders/ord_1', '/emails', '/profile', '/settings', '/settings/billing', '/admin/reviews', '/admin/flags']) {
			expect(replayPausedOn(path), path).toBe(true);
		}
		for (const path of ['/', '/chat/abc', '/settingsx', '/discover', '/pricing', '/catalog', '/apps']) expect(replayPausedOn(path), path).toBe(false);
	});

	it('drops the query and fragment of every captured address, replay data included, and keeps the path', () => {
		const event = {
			uuid: 'u1',
			event: '$pageview',
			properties: {
				$current_url: 'https://estori.app/reset-password?token=secret#top',
				$pathname: '/reset-password',
				$referrer: 'https://estori.app/verify-email?token=other',
				$snapshot_data: [
					{ type: 4, data: { href: 'https://estori.app/chat/new?query=Build%20a%20tea%20store', width: 1280, height: 800 } },
					{ type: 3, data: { source: 2 } },
				],
			},
			$set: { $current_url: 'https://estori.app/settings?tab=keys' },
			$set_once: { $initial_current_url: 'https://estori.app/?ref=launch' },
		} as unknown as CaptureResult;
		const sent = stripUrlQueries(event);
		expect(sent?.properties).toMatchObject({ $current_url: 'https://estori.app/reset-password', $pathname: '/reset-password', $referrer: 'https://estori.app/verify-email' });
		expect(sent?.properties.$snapshot_data[0].data.href).toBe('https://estori.app/chat/new');
		expect(sent?.$set).toEqual({ $current_url: 'https://estori.app/settings' });
		expect(sent?.$set_once).toEqual({ $initial_current_url: 'https://estori.app/' });
		expect(stripUrlQueries(null)).toBeNull();
		expect(withoutQuery('https://estori.app/discover')).toBe('https://estori.app/discover');
	});

	it('drops the query of addresses at any depth, and of heatmap data keyed by page address, merging pages that then match', () => {
		const event = {
			uuid: 'u2',
			event: '$$heatmap',
			properties: {
				$current_url: 'https://estori.app/reset-password?token=secret',
				$heatmap_data: {
					'https://estori.app/reset-password?token=secret': [{ x: 10, y: 20, target_fixed: false, type: 'click' }],
					'https://estori.app/reset-password?token=other#form': [{ x: 30, y: 40, target_fixed: false, type: 'mousemove' }],
					'https://estori.app/discover': [{ x: 1, y: 2, target_fixed: true, type: 'click' }],
				},
			},
		} as unknown as CaptureResult;
		const sent = stripUrlQueries(event);
		expect(sent?.properties).toEqual({
			$current_url: 'https://estori.app/reset-password',
			$heatmap_data: {
				'https://estori.app/reset-password': [
					{ x: 10, y: 20, target_fixed: false, type: 'click' },
					{ x: 30, y: 40, target_fixed: false, type: 'mousemove' },
				],
				'https://estori.app/discover': [{ x: 1, y: 2, target_fixed: true, type: 'click' }],
			},
		});
		expect(JSON.stringify(sent)).not.toContain('secret');
	});

	it('drops the query of the address inside each web vital, and of every address a request or an error names', () => {
		const event = {
			uuid: 'u3',
			event: '$web_vitals',
			properties: {
				$current_url: 'https://estori.app/verify-email?token=secret',
				$web_vitals_LCP_value: 1200,
				$web_vitals_LCP_event: {
					name: 'LCP',
					value: 1200,
					$current_url: 'https://estori.app/verify-email?token=secret',
					attribution: { url: 'https://cdn.example.com/hero.png?signature=secret', element: 'main > img' },
				},
				$snapshot_data: [
					{ type: 6, data: { plugin: 'rrweb/network@1', payload: { requests: [{ name: 'https://estori.app/api/auth/verify-email?token=secret', duration: 80 }] } } },
				],
				$exception_message: 'Request to https://estori.app/api/reset?token=secret failed',
				$referrer: '$direct',
			},
		} as unknown as CaptureResult;
		const sent = stripUrlQueries(event);
		expect(sent?.properties.$current_url).toBe('https://estori.app/verify-email');
		expect(sent?.properties.$web_vitals_LCP_event).toEqual({
			name: 'LCP',
			value: 1200,
			$current_url: 'https://estori.app/verify-email',
			attribution: { url: 'https://cdn.example.com/hero.png', element: 'main > img' },
		});
		expect(sent?.properties.$snapshot_data[0].data.payload.requests[0].name).toBe('https://estori.app/api/auth/verify-email');
		expect(sent?.properties.$exception_message).toBe('Request to https://estori.app/api/reset failed');
		expect(sent?.properties.$referrer).toBe('$direct');
		expect(JSON.stringify(sent)).not.toContain('secret');
	});

	it('reads GPC only when the browser says true', () => {
		expect(globalPrivacyControl({ globalPrivacyControl: true } as Navigator & { globalPrivacyControl?: boolean })).toBe(true);
		expect(globalPrivacyControl({} as Navigator)).toBe(false);
	});
});
