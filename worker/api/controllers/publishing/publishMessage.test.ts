import { describe, expect, it } from 'vitest';
import type { PublishRequest } from '../../../services/templates/reuse';
import { publishMessage } from './publishMessage';

const FREE: PublishRequest = { visibility: 'public', category: 'landing', priceCents: 0 };
const PAID: PublishRequest = { visibility: 'public', category: 'store', priceCents: 2900 };

describe('publishMessage', () => {
	it('confirms a private site', () => {
		expect(publishMessage({ visibility: 'private' }, { inReview: false, approvedLive: false })).toBe('Your site is private');
	});

	it('says others can use a first paid submission once an admin approves the price', () => {
		expect(publishMessage(PAID, { inReview: true, approvedLive: false })).toBe(
			'Your site is public. Others can use it once an admin approves the price.',
		);
	});

	it('says the approved version stays live when an update goes to review', () => {
		expect(publishMessage(PAID, { inReview: true, approvedLive: true })).toBe(
			'Your update is in review. The approved version stays live until an admin approves it.',
		);
	});

	it('confirms saved settings and a free reusable site when nothing goes to review', () => {
		expect(publishMessage(PAID, { inReview: false, approvedLive: true })).toBe('Your publishing settings are saved');
		expect(publishMessage(FREE, { inReview: false, approvedLive: false })).toBe('Your site is public and others can reuse it');
	});
});
