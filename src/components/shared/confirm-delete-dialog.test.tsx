/**
 * The delete confirmation mounted for real: the delete button stays disabled until the resource's name is typed, and
 * every word of the dialog follows the language. Kumo's dialog pieces render into a portal, which the test renderer
 * can't mount, so they are swapped for plain wrappers here; the dialog's own logic and text are what is under test.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import type TestRenderer from 'react-test-renderer';
import { applyAccountLocale } from '@/lib/i18n';
import { mountElement, silenceTestRendererDeprecation, textOf, unmountAll } from '@/test-support/mounted';
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog';

vi.mock('@cloudflare/kumo', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@cloudflare/kumo')>();
	const wrapper = (tag: string) => (props: { children?: ReactNode }) => createElement(tag, null, props.children);
	return {
		...actual,
		DialogRoot: (props: { open: boolean; children?: ReactNode }) => (props.open ? createElement('div', null, props.children) : null),
		Dialog: wrapper('section'),
		DialogTitle: wrapper('h2'),
		DialogDescription: wrapper('p'),
		DialogClose: (props: { render: (props: object) => ReactNode }) => props.render({}),
	};
});

beforeAll(silenceTestRendererDeprecation);

afterEach(async () => {
	await unmountAll();
	await applyAccountLocale('en');
});

const onDelete = vi.fn(async () => undefined);

async function mountDialog(overrides: { caseSensitive?: boolean; isDeleting?: boolean; errorMessage?: string } = {}) {
	onDelete.mockClear();
	return mountElement(
		createElement(ConfirmDeleteDialog, {
			open: true,
			onOpenChange: () => undefined,
			resourceType: 'App',
			resourceName: 'Lucia Candles',
			onDelete,
			deleteButtonText: 'Delete App',
			...overrides,
		}),
	);
}

/** The button that deletes: the last one in the dialog. */
const deleteButton = (renderer: TestRenderer.ReactTestRenderer) => renderer.root.findAllByType('button').at(-1)!;
/** Types into the field the way the browser reports it: Kumo's input reads the value from the event's current target. */
const typeName = (renderer: TestRenderer.ReactTestRenderer, value: string) =>
	act(() => renderer.root.findByType('input').props.onChange({ currentTarget: { value }, target: { value }, nativeEvent: { defaultPrevented: false } }));

describe('ConfirmDeleteDialog', () => {
	it('keeps the delete button disabled until the name is typed, and then deletes', async () => {
		const renderer = await mountDialog();
		expect(deleteButton(renderer).props.disabled).toBe(true);
		await typeName(renderer, 'Lucia');
		expect(deleteButton(renderer).props.disabled).toBe(true);
		await typeName(renderer, 'Lucia Candles');
		expect(deleteButton(renderer).props.disabled).toBe(false);
		await act(async () => deleteButton(renderer).props.onClick());
		expect(onDelete).toHaveBeenCalledTimes(1);
	});

	it('matches the capitals of the name unless told not to', async () => {
		const strict = await mountDialog();
		await typeName(strict, 'lucia candles');
		expect(deleteButton(strict).props.disabled).toBe(true);
		const relaxed = await mountDialog({ caseSensitive: false });
		await typeName(relaxed, 'lucia candles');
		expect(deleteButton(relaxed).props.disabled).toBe(false);
	});

	it('does not delete while a delete is under way, and shows why one failed', async () => {
		const renderer = await mountDialog({ isDeleting: true, errorMessage: 'Try later' });
		await typeName(renderer, 'Lucia Candles');
		expect(deleteButton(renderer).props.disabled).toBe(true);
		expect(textOf(renderer)).toContain('Try later');
	});

	it('is in English by default', async () => {
		const text = textOf(await mountDialog());
		for (const phrase of ['Delete Lucia Candles', 'This action cannot be undone. This will permanently delete the', 'Lucia Candles', 'app.', 'Type', 'to confirm:', 'Cancel']) expect(text).toContain(phrase);
	});

	it('reads in Spanish and Portuguese, keeping the name the seller gave', async () => {
		await applyAccountLocale('es');
		const spanish = textOf(await mountDialog());
		for (const phrase of ['Eliminar Lucia Candles', 'Esta acción no se puede deshacer.', '(app).', 'Escribe', 'para confirmar:', 'Cancelar']) expect(spanish).toContain(phrase);
		expect(spanish).not.toContain('Cancel ');
		// Taken down first, so the next language is not an update to a dialog that is still on screen.
		await unmountAll();
		await applyAccountLocale('pt-BR');
		const portuguese = textOf(await mountDialog());
		for (const phrase of ['Excluir Lucia Candles', 'Esta ação não pode ser desfeita.', 'Digite', 'para confirmar:', 'Cancelar']) expect(portuguese).toContain(phrase);
	});

	it('translates the labels a screen reader reads', async () => {
		await applyAccountLocale('es');
		const renderer = await mountDialog();
		const labels = renderer.root.findAll((node) => typeof node.props['aria-label'] === 'string').map((node) => node.props['aria-label']);
		expect(labels).toContain('Cerrar');
		expect(labels).toContain('Copiar Lucia Candles al portapapeles');
		expect(labels).toContain('Escribe Lucia Candles para confirmar la eliminación');
	});
});
