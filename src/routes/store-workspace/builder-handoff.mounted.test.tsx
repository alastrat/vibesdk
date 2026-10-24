import type { ReactTestInstance } from 'react-test-renderer';
import { act, type ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mountElement, silenceTestRendererDeprecation, textOf, unmountAll } from '@/test-support/mounted';
import { readBuilderDraft } from '../chat/utils/builder-draft';
import { BuilderHandoff } from './builder-handoff';

// Only replace dialog portals; navigation, review state and the draft parser remain real.
vi.mock('@cloudflare/kumo', async (original) => {
 const actual = await original<typeof import('@cloudflare/kumo')>();
 const Dialog = Object.assign(({ children }: { children: ReactNode }) => <section>{children}</section>, {
  Root: ({ open, children }: { open: boolean; children: ReactNode }) => open ? <div role="dialog">{children}</div> : null,
  Title: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  Description: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  Close: () => null,
 });
 return { ...actual, Dialog };
});
function ComposerDestination() {
 const location = useLocation();
 const { id } = useParams();
 return <div><textarea aria-label="Composer draft" value={readBuilderDraft(location.state, id)} readOnly /><span>{location.pathname}</span><span>{location.state?.fromPrompt ? 'Automatic request' : 'Awaiting send'}</span></div>;
}
function buttonText(node: ReactTestInstance): string { return node.children.map((child) => typeof child === 'string' ? child : buttonText(child)).join(''); }
beforeAll(silenceTestRendererDeprecation);
afterEach(unmountAll);
describe('reviewed builder handoff', () => {
 it('opens the chosen existing store with the reviewed text and no automatic request', async () => {
  const renderer = await mountElement(<MemoryRouter initialEntries={['/stores/tea']}><Routes><Route path="/stores/:id" element={<BuilderHandoff appId="tea" label="Edit product" request="Edit Green tea (product green-tea)." />} /><Route path="/chat/:id" element={<ComposerDestination />} /></Routes></MemoryRouter>);
  await act(async () => renderer.root.findAllByType('button').find((button) => buttonText(button).includes('Edit product'))!.props.onClick());
  expect(textOf(renderer)).toContain('Continue in your store builder');
  const field = renderer.root.findByType('textarea');
  expect(field.props.value).toContain('green-tea');
  await act(async () => field.props.onChange({ target: { value: 'Change Green tea to $18.' } }));
  await act(async () => renderer.root.findAllByType('button').find((button) => buttonText(button).includes('Open in builder'))!.props.onClick());
  expect(renderer.root.findByProps({ 'aria-label': 'Composer draft' }).props.value).toBe('Change Green tea to $18.');
  expect(textOf(renderer)).toContain('/chat/tea');
  expect(textOf(renderer)).toContain('Awaiting send');
 });
});
