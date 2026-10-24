import { describe, expect, it } from 'vitest';
import { readBuilderDraft } from './builder-draft';
describe('explicit store builder draft handoff', () => {
 it('prefills only the selected existing store', () => {
  const state = { builderDraft: { source: 'store-workspace', appId: 'tea', text: 'Update the green tea product.' } };
  expect(readBuilderDraft(state, 'tea')).toBe('Update the green tea product.');
  expect(readBuilderDraft(state, 'other')).toBe('');
  expect(readBuilderDraft(state, 'new')).toBe('');
 });
 it('rejects arbitrary route state and oversized or empty drafts', () => {
  for (const state of [null, 'message', { query: 'send this' }, { builderDraft: { source: 'external', appId: 'tea', text: 'Hello' } }, { builderDraft: { source: 'store-workspace', appId: 'tea', text: 'x'.repeat(4001) } }, { builderDraft: { source: 'store-workspace', appId: 'tea', text: '  ' } }]) expect(readBuilderDraft(state, 'tea')).toBe('');
 });
});
