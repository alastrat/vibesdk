import { describe, expect, it } from 'vitest';
import { escapeHtml } from './html';

describe('escapeHtml', () => {
	it('escapes every character that could end text or a quoted attribute', () => {
		expect(escapeHtml(`Tom & Jerry's "<b>show</b>"`)).toBe('Tom &amp; Jerry&#39;s &quot;&lt;b&gt;show&lt;/b&gt;&quot;');
	});

	it('escapes an ampersand before the entities it writes, so nothing is escaped twice', () => {
		expect(escapeHtml('&lt;')).toBe('&amp;lt;');
	});
});
