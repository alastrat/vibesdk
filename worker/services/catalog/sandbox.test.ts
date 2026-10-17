import { describe, expect, it } from 'vitest';
import { sandboxMoves } from './sandbox';

describe('sandboxMoves', () => {
	it('ships a paid sandbox order with a tracking number, and delivers a shipped one', () => {
		expect(sandboxMoves('ship')).toEqual([{ kind: 'status', status: 400 }, { kind: 'track' }, { kind: 'status', status: 500 }]);
		expect(sandboxMoves('deliver')).toEqual([{ kind: 'status', status: 600 }]);
	});
});
