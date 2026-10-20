import { isContactTopic, isPremiumCredits, type ContactTopic } from '@/api-types';

/** The contact page, opened on a topic; Premium can carry the AI credits a month the visitor needs. */
export function contactPath(topic: ContactTopic, premiumCredits?: number): string {
	const params = new URLSearchParams({ topic });
	if (topic === 'premium' && premiumCredits !== undefined) params.set('credits', String(premiumCredits));
	return `/contact?${params.toString()}`;
}

/** What a contact link asks to fill in: a known topic, and for Premium the credits a month when they're a whole number in range. */
export function contactPrefill(search: string): { topic: ContactTopic | null; premiumCredits: number | null } {
	const params = new URLSearchParams(search);
	const topic = params.get('topic');
	const credits = Number(params.get('credits'));
	const knownTopic = isContactTopic(topic) ? topic : null;
	return { topic: knownTopic, premiumCredits: knownTopic === 'premium' && isPremiumCredits(credits) ? credits : null };
}
