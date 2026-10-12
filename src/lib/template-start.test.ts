import { describe, expect, it } from 'vitest';
import { templateStartPath } from './template-start';

describe('templateStartPath', () => {
	it('builds the chat URL with the template, description and model', () => {
		expect(templateStartPath({ templateId: 'tpl1', description: '  A bakery in Lisbon ', modelId: 'claude-sonnet' })).toBe(
			'/chat/new?template=tpl1&query=A+bakery+in+Lisbon&projectType=app&behaviorType=think&model=claude-sonnet',
		);
	});

	it('starts an exact copy with an empty query', () => {
		expect(templateStartPath({ templateId: 'tpl1', description: '' })).toBe(
			'/chat/new?template=tpl1&query=&projectType=app&behaviorType=think',
		);
	});
});
