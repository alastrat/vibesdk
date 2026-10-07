import { describe, expect, it } from 'vitest';
import { screenshotTarget } from './screenshot-policy';

describe('screenshotTarget', () => {
	it('captures nothing before the app has been deployed', () => {
		expect(screenshotTarget({})).toBeNull();
		expect(screenshotTarget({ screenshotCommit: 'abc123' })).toBeNull();
	});

	it('captures a deployed commit the stored thumbnail does not show yet', () => {
		expect(screenshotTarget({ lastDeployedCommit: 'def456' })).toBe('def456');
		expect(screenshotTarget({ lastDeployedCommit: 'def456', screenshotCommit: 'abc123' })).toBe('def456');
	});

	it('skips a commit the stored thumbnail already shows', () => {
		expect(screenshotTarget({ lastDeployedCommit: 'abc123', screenshotCommit: 'abc123' })).toBeNull();
	});

	it('skips a commit that is already being captured', () => {
		expect(screenshotTarget({ lastDeployedCommit: 'def456', screenshotCommit: 'abc123', inFlightCommit: 'def456' })).toBeNull();
	});

	it('captures a newer commit while an older capture is still running', () => {
		expect(screenshotTarget({ lastDeployedCommit: 'ghi789', inFlightCommit: 'def456' })).toBe('ghi789');
	});
});
