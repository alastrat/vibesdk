import { describe, expect, it, vi } from 'vitest';
import type { DraftsSnapshot } from '@space-do/space';
import { STORE_DRAFTS_PAUSED_MESSAGE } from '../../../../shared/types/drafts';
import type { RouteContext } from '../../types/route-context';

const { isFlagOn } = vi.hoisted(() => ({ isFlagOn: vi.fn(async () => true) }));
// The agents module pulls in the Durable Object classes, which the test runtime can't load; these tests never reach it.
vi.mock('../../../agents', () => ({ getAgentStub: vi.fn() }));
vi.mock('../../../services/posthog/flags', () => ({ isFlagOn }));

const { getAgentStub } = await import('../../../agents');
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

describe('starting a draft while drafts are paused', () => {
	it('is refused with 503 before the agent is asked', async () => {
		const { DraftsController } = await import('./controller');
		const env = { SPACE_DO: { idFromName: (name: string) => name, get: () => ({ listDrafts: async () => SNAPSHOT }) } } as unknown as Env;
		const request = new Request('https://estori.app/api/stores/app_1/drafts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Sale' }) });
		const response = await DraftsController.create(request, env, {} as ExecutionContext, { pathParams: { id: 'app_1' }, user: { id: 'seller_1' } } as unknown as RouteContext);
		expect(response.status).toBe(503);
		expect((await response.json()).error.message).toBe(STORE_DRAFTS_PAUSED_MESSAGE);
		expect(isFlagOn).toHaveBeenCalledWith(env, 'store-drafts-paused', 'seller_1');
		expect(getAgentStub).not.toHaveBeenCalled();
	});
});
