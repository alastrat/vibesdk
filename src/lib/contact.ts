import { isContactTopic, type ContactTopic } from '@/api-types';
import { PREMIUM_TIERS } from './plans';

/** The contact page, opened on a topic; Premium can carry the credit pool the visitor picked. */
export function contactPath(topic: ContactTopic, premiumCredits?: number): string {
	const params = new URLSearchParams({ topic });
	if (topic === 'premium' && premiumCredits !== undefined) params.set('credits', String(premiumCredits));
	return `/contact?${params.toString()}`;
}

/** What a contact link asks to fill in: a known topic, and a Premium pool only when it's one we offer. */
export function contactPrefill(search: string): { topic: ContactTopic | null; premiumCredits: number | null } {
	const params = new URLSearchParams(search);
	const topic = params.get('topic');
	const credits = Number(params.get('credits'));
	const knownTopic = isContactTopic(topic) ? topic : null;
	return {
		topic: knownTopic,
		premiumCredits: knownTopic === 'premium' && PREMIUM_TIERS.some((tier) => tier.credits === credits) ? credits : null,
	};
}
