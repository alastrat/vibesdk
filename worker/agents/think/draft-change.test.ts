import { describe, expect, it } from 'vitest';
import { activeDraftOf, DRAFT_SWITCHING_TOOLS, draftErrorStatus } from './draft-change';

describe('activeDraftOf', () => {
	it("reads the draft a tool switched to from its JSON output, so the host's preview follows it", () => {
		const output = JSON.stringify({ activeDraft: { id: 'k3x9q2mf', name: 'Spring sale', branch: 'draft-k3x9q2mf' } });
		expect(activeDraftOf(output)).toEqual({ id: 'k3x9q2mf', name: 'Spring sale', branch: 'draft-k3x9q2mf' });
		expect(activeDraftOf({ activeDraft: { id: 'main', name: 'Main', branch: 'main' } })).toEqual({ id: 'main', name: 'Main', branch: 'main' });
	});

	it('ignores outputs without a well-formed draft', () => {
		for (const output of ['not json', '{}', JSON.stringify({ activeDraft: { id: 1 } }), null, 42]) {
			expect(activeDraftOf(output)).toBeNull();
		}
	});

	it('lists the tools that can change the active draft', () => {
		expect([...DRAFT_SWITCHING_TOOLS].sort()).toEqual(['bring_in_live_changes', 'create_draft', 'switch_draft']);
	});

	it('answers 404 for a missing draft and 409 for any other refusal', () => {
		expect(draftErrorStatus("That draft doesn't exist.")).toBe(404);
		expect(draftErrorStatus("Couldn't save your work before switching. Try again.")).toBe(409);
	});
});
