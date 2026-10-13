import { describe, expect, it } from 'vitest';
import { reuseStartPath } from './reuse-start';

describe('reuseStartPath', () => {
	it('starts a Think session from the site with the trimmed description and model', () => {
		const path = reuseStartPath({ sourceAppId: 'app1', description: '  A bakery  ', modelId: 'anthropic/claude-sonnet-5-5' });
		const url = new URL(path, 'http://localhost');
		expect(url.pathname).toBe('/chat/new');
		expect(url.searchParams.get('source')).toBe('app1');
		expect(url.searchParams.get('query')).toBe('A bakery');
		expect(url.searchParams.get('behaviorType')).toBe('think');
		expect(url.searchParams.get('model')).toBe('anthropic/claude-sonnet-5-5');
	});

	it('leaves the model out when none is picked', () => {
		expect(new URL(reuseStartPath({ sourceAppId: 'app1', description: '' }), 'http://localhost').searchParams.has('model')).toBe(
			false,
		);
	});
});
