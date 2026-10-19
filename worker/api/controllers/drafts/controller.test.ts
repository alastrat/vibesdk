import { describe, expect, it, vi } from 'vitest';
import type { DraftsSnapshot } from '@space-do/space';

// The agents module pulls in the Durable Object classes, which the test runtime can't load; these tests never reach it.
vi.mock('../../../agents', () => ({ getAgentStub: vi.fn() }));

const { draftsResponse, parseCreateDraft, parseRenameDraft } = await import('./controller');

const SNAPSHOT: DraftsSnapshot = { drafts: [], activeDraftId: 'main', published: false, limit: 5 };

describe('drafts requests', () => {
	it('takes a name and where the draft starts from', () => {
		expect(parseCreateDraft({ name: ' Spring sale ', from: 'live' })).toEqual({ name: ' Spring sale ', from: 'live' });
		expect(parseCreateDraft({ name: 'Sale' })).toEqual({ name: 'Sale', from: 'main' });
		expect(parseCreateDraft({ name: 'Sale', from: 'published' })).toEqual({ error: 'Start the draft from Main or from the live store.' });
		expect(parseCreateDraft({ from: 'main' })).toEqual({ error: 'Give the draft a name.' });
		expect(parseRenameDraft({ name: 'Summer' })).toEqual({ name: 'Summer' });
		expect(parseRenameDraft({ name: 7 })).toEqual({ error: 'Give the draft a name.' });
	});
});

describe('drafts responses', () => {
	it('answers the store snapshot, or the refusal with its status', async () => {
		expect(await draftsResponse({ ok: true }, async () => SNAPSHOT)).toEqual({ data: SNAPSHOT });
		expect(await draftsResponse({ error: 'Main can\'t be deleted.' }, async () => SNAPSHOT)).toEqual({ error: "Main can't be deleted.", status: 409 });
		expect(await draftsResponse({ error: 'Wait for the AI to finish, then switch drafts.', status: 409 }, async () => SNAPSHOT)).toEqual({
			error: 'Wait for the AI to finish, then switch drafts.',
			status: 409,
		});
		expect(await draftsResponse({ error: "That draft doesn't exist." }, async () => SNAPSHOT)).toEqual({ error: "That draft doesn't exist.", status: 404 });
	});
});
