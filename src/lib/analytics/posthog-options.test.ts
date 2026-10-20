import { describe, expect, it } from 'vitest';
import type { CaptureResult } from 'posthog-js';
import { globalPrivacyControl, maskReplayAttribute, posthogInitOptions, replayPausedOn, scrubEvent, withoutQuery } from './posthog-options';

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
			session_recording: {
				maskAllInputs: true,
				maskTextSelector: '*',
				blockSelector: 'img, iframe',
				maskAttributeFn: maskReplayAttribute,
				recordHeaders: false,
				recordBody: false,
			},
			before_send: scrubEvent,
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
		const sent = scrubEvent(event);
		expect(sent?.properties).toMatchObject({ $current_url: 'https://estori.app/reset-password', $pathname: '/reset-password', $referrer: 'https://estori.app/verify-email' });
		expect(sent?.properties.$snapshot_data[0].data.href).toBe('https://estori.app/chat/new');
		expect(sent?.$set).toEqual({ $current_url: 'https://estori.app/settings' });
		expect(sent?.$set_once).toEqual({ $initial_current_url: 'https://estori.app/' });
		expect(scrubEvent(null)).toBeNull();
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
		const sent = scrubEvent(event);
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
		const sent = scrubEvent(event);
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

	it("drops the page title posthog-js adds to each pageview, since it names the seller's app", () => {
		const event = {
			uuid: 'u4',
			event: '$pageview',
			properties: { title: 'Tea Shop · Estori', $current_url: 'https://estori.app/chat/abc', $pathname: '/chat/abc' },
		} as unknown as CaptureResult;
		expect(scrubEvent(event)?.properties).toEqual({ $current_url: 'https://estori.app/chat/abc', $pathname: '/chat/abc' });
	});

	it('replaces every email address with [email], in values and keys at any depth, browser exceptions included', () => {
		const event = {
			uuid: 'u5',
			event: '$exception',
			properties: {
				$current_url: 'https://estori.app/u/ana%40example.com?token=secret',
				$exception_list: [{ type: 'Error', value: 'No account for ana+shop@example.co.uk', stacktrace: { frames: [{ filename: 'https://estori.app/assets/index.js' }] } }],
				$heatmap_data: { 'https://estori.app/u/bob@example.org': [{ x: 1, y: 2 }] },
				$lib: 'web',
			},
			$set: { contact: 'Write to "x@y.io"' },
		} as unknown as CaptureResult;
		const sent = scrubEvent(event);
		// The pattern takes the longest run before the @, so an address in a path takes the path with it.
		expect(sent?.properties).toEqual({
			$current_url: 'https:[email]',
			$exception_list: [{ type: 'Error', value: 'No account for [email]', stacktrace: { frames: [{ filename: 'https://estori.app/assets/index.js' }] } }],
			$heatmap_data: { 'https:[email]': [{ x: 1, y: 2 }] },
			$lib: 'web',
		});
		expect(sent?.$set).toEqual({ contact: 'Write to "[email]"' });
	});

	it('leaves compressed replay data as it is, since its text is gzip bytes that rewriting would corrupt', () => {
		const bytes = 'gz\u0000a@b.co%40https://x.io/?q#';
		const event = {
			uuid: 'u6',
			event: '$snapshot',
			properties: { $snapshot_data: [{ type: 2, cv: '2024-10', data: bytes }, { type: 4, data: { href: 'https://estori.app/reset-password?token=secret' } }] },
		} as unknown as CaptureResult;
		const sent = scrubEvent(event);
		expect(sent?.properties.$snapshot_data[0]).toEqual({ type: 2, cv: '2024-10', data: bytes });
		expect(sent?.properties.$snapshot_data[1].data.href).toBe('https://estori.app/reset-password');
	});

	it("masks the words in replay's attributes, as page text is masked, and drops the query of their addresses", () => {
		for (const name of ['title', 'alt', 'placeholder', 'aria-label', 'aria-description', 'aria-valuetext', 'TITLE']) {
			expect(maskReplayAttribute(name, 'Tea Shop'), name).toBe('********');
		}
		for (const name of ['href', 'src', 'action', 'formaction', 'poster']) {
			expect(maskReplayAttribute(name, 'https://estori.app/verify-email?token=secret#top'), name).toBe('https://estori.app/verify-email');
		}
		expect(maskReplayAttribute('href', '/chat/new?query=Build%20a%20store')).toBe('/chat/new');
		expect(maskReplayAttribute('href', 'mailto:ana@example.com')).toBe('mailto:[email]');
	});

	it('keeps styles and every other attribute as they are, so layouts still replay', () => {
		const style = 'background: url(https://estori.app/hero.png?v=2); width: 10px';
		const css = '.a{background:url(https://estori.app/a.png?v=1)}@media (min-width:1px){.b{color:red}}';
		expect(maskReplayAttribute('style', style)).toBe(style);
		expect(maskReplayAttribute('_cssText', css)).toBe(css);
		expect(maskReplayAttribute('class', 'flex items-center')).toBe('flex items-center');
		expect(maskReplayAttribute('data-state', 'open')).toBe('open');
	});

	it('reads GPC only when the browser says true', () => {
		expect(globalPrivacyControl({ globalPrivacyControl: true } as Navigator & { globalPrivacyControl?: boolean })).toBe(true);
		expect(globalPrivacyControl({} as Navigator)).toBe(false);
	});
});
