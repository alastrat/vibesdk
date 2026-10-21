/**
 * The overlay script in a small fake DOM: text and attributes a store's scripts add or change after load are
 * translated, its own writes are not seen again, and it normalizes text exactly as the extractor does.
 */

import { describe, expect, it } from 'vitest';
import { overlayScript } from './overlay-script';
import { normalizeText } from './extract';

interface FakeRecord {
	type: 'childList' | 'characterData' | 'attributes';
	target: FakeNode;
	addedNodes: FakeNode[];
	attributeName: string | null;
}

type FakeNode = FakeText | FakeElement;

/** The page's one observer, and the records it has not been handed yet. */
class FakeDocument {
	observer: FakeObserver | null = null;
	documentElement: FakeElement;
	/** Every text and attribute write, by anyone, in order. */
	writes: string[] = [];

	constructor() {
		this.documentElement = new FakeElement(this, 'html');
	}

	notify(record: Omit<FakeRecord, 'addedNodes' | 'attributeName'> & Partial<FakeRecord>): void {
		const observer = this.observer;
		if (!observer?.options) return;
		if (record.type === 'attributes' && !observer.options.attributeFilter.includes(record.attributeName ?? '')) return;
		observer.pending.push({ addedNodes: [], attributeName: null, ...record });
	}

	/** Delivers what was recorded, as the browser does after the script that made the changes. */
	flush(): void {
		const observer = this.observer;
		while (observer && observer.pending.length > 0) observer.callback(observer.takeRecords());
	}

	element(name: string, attributes: Record<string, string> = {}, ...children: Array<FakeNode | string>): FakeElement {
		const element = new FakeElement(this, name);
		for (const [attribute, value] of Object.entries(attributes)) element.attributes.set(attribute, value);
		for (const child of children) element.adopt(typeof child === 'string' ? new FakeText(this, child) : child);
		return element;
	}

	text(data: string): FakeText {
		return new FakeText(this, data);
	}
}

class FakeText {
	readonly nodeType = 3;
	readonly nodeName = '#text';
	parentNode: FakeElement | null = null;

	constructor(
		private readonly document: FakeDocument,
		private value: string,
	) {}

	get data(): string {
		return this.value;
	}

	set data(value: string) {
		this.value = value;
		this.document.writes.push(`text:${value}`);
		this.document.notify({ type: 'characterData', target: this });
	}

	get nextSibling(): FakeNode | null {
		return siblingAfter(this);
	}
}

class FakeElement {
	readonly nodeType = 1;
	readonly nodeName: string;
	parentNode: FakeElement | null = null;
	readonly attributes = new Map<string, string>();
	readonly childNodes: FakeNode[] = [];

	constructor(
		private readonly document: FakeDocument,
		name: string,
	) {
		this.nodeName = name.toUpperCase();
	}

	get firstChild(): FakeNode | null {
		return this.childNodes[0] ?? null;
	}

	get nextSibling(): FakeNode | null {
		return siblingAfter(this);
	}

	getAttribute(name: string): string | null {
		return this.attributes.get(name) ?? null;
	}

	hasAttribute(name: string): boolean {
		return this.attributes.has(name);
	}

	setAttribute(name: string, value: string): void {
		this.attributes.set(name, value);
		this.document.writes.push(`${name}:${value}`);
		this.document.notify({ type: 'attributes', target: this, attributeName: name });
	}

	adopt(node: FakeNode): void {
		node.parentNode = this;
		this.childNodes.push(node);
	}

	appendChild(node: FakeNode): void {
		this.adopt(node);
		this.document.notify({ type: 'childList', target: this, addedNodes: [node] });
	}

	get textContent(): string {
		return this.childNodes.map((child) => (child instanceof FakeText ? child.data : child.textContent)).join('');
	}
}

function siblingAfter(node: FakeNode): FakeNode | null {
	const siblings = node.parentNode?.childNodes ?? [];
	return siblings[siblings.indexOf(node) + 1] ?? null;
}

class FakeObserver {
	static document: FakeDocument;
	pending: FakeRecord[] = [];
	options: { attributeFilter: string[] } | null = null;

	constructor(readonly callback: (records: FakeRecord[]) => void) {
		FakeObserver.document.observer = this;
	}

	observe(_target: FakeElement, options: { childList: boolean; characterData: boolean; subtree: boolean; attributes: boolean; attributeFilter: string[] }): void {
		expect(options).toMatchObject({ childList: true, characterData: true, subtree: true, attributes: true });
		this.options = options;
	}

	takeRecords(): FakeRecord[] {
		return this.pending.splice(0);
	}
}

/** A page with a body and a main element, and the overlay script run on it. */
function pageWithOverlay(entries: [string, string][], ...content: Array<FakeNode | string>) {
	const document = new FakeDocument();
	const main = document.element('main', {}, ...content);
	const body = document.element('body', {}, main);
	document.documentElement.adopt(body);
	FakeObserver.document = document;
	new Function('document', 'MutationObserver', overlayScript('es', entries))(document, FakeObserver);
	return { document, main };
}

const ENTRIES: [string, string][] = [
	['Add to cart', 'Agregar al carrito'],
	['Fresh tea', 'Té fresco'],
	['Sold out', 'Agotado'],
];

describe('the overlay script', () => {
	it('translates text added later', () => {
		const { document, main } = pageWithOverlay(ENTRIES);
		const button = document.element('button', { type: 'submit' }, '\n  Add to cart ');
		main.appendChild(button);
		const price = document.element('p', {}, 'Fresh tea ', document.element('b', {}, 'Sold out'));
		main.appendChild(price);
		document.flush();
		expect(button.textContent).toBe('\n  Agregar al carrito ');
		expect(price.textContent).toBe('Té fresco Agotado');

		// A store script changing a text node or an attribute later.
		const label = button.childNodes[0] as FakeText;
		label.data = 'Sold out';
		button.setAttribute('aria-label', 'Fresh tea');
		const submit = document.element('input', { type: 'Submit', value: 'Add to cart' });
		const field = document.element('input', { type: 'text', value: 'Add to cart' });
		main.appendChild(submit);
		main.appendChild(field);
		document.flush();
		expect(label.data).toBe('Agotado');
		expect(button.getAttribute('aria-label')).toBe('Té fresco');
		expect(submit.getAttribute('value')).toBe('Agregar al carrito');
		expect(field.getAttribute('value')).toBe('Add to cart');

		// Its own writes come back as records it drops, so nothing is written twice.
		expect(document.observer?.pending).toEqual([]);
		expect(document.writes.filter((write) => write.includes('Agotado'))).toEqual(['text:Agotado', 'text:Agotado']);
	});

	it('leaves unknown text', () => {
		const { document, main } = pageWithOverlay(ENTRIES);
		const note = document.element('p', { title: 'Brewed daily' }, 'Brewed every morning');
		main.appendChild(note);
		document.flush();
		expect(note.textContent).toBe('Brewed every morning');
		expect(note.getAttribute('title')).toBe('Brewed daily');
		expect(document.writes).toEqual([]);
	});

	it('leaves code, templates, form values and the language switcher alone', () => {
		const { document, main } = pageWithOverlay(ENTRIES);
		const code = document.element('pre', { title: 'Fresh tea' }, document.element('span', { title: 'Fresh tea' }, 'Fresh tea'));
		const script = document.element('script', {}, 'Fresh tea');
		const area = document.element('textarea', { placeholder: 'Fresh tea' }, 'Fresh tea');
		const switcher = document.element('details', { 'data-estori-languages': '' }, document.element('summary', {}, 'Fresh tea'));
		for (const element of [code, script, area, switcher]) main.appendChild(element);
		document.flush();
		expect(code.getAttribute('title')).toBe('Fresh tea');
		expect(code.textContent).toBe('Fresh tea');
		expect(script.textContent).toBe('Fresh tea');
		expect(area.textContent).toBe('Fresh tea');
		expect(area.getAttribute('placeholder')).toBe('Té fresco');
		expect(switcher.textContent).toBe('Fresh tea');
	});

	it('translates what earlier scripts wrote before it ran', () => {
		const { main } = pageWithOverlay(ENTRIES, 'Fresh tea');
		expect(main.textContent).toBe('Té fresco');
	});

	it('normalizes text as the extractor does', () => {
		const cases = ['  Fresh  tea  ', '\tFresh\n\n\ttea\r\n', 'Fresh tea', '﻿Fresh tea　', 'Fresh tea'];
		const entries = cases.map((text, index): [string, string] => [normalizeText(text), `T${index}`]);
		expect(new Set(entries.map(([key]) => key))).toEqual(new Set(['Fresh tea']));
		for (const text of cases) {
			const { document, main } = pageWithOverlay([['Fresh tea', 'Té fresco']]);
			const node = document.text(text);
			main.appendChild(node);
			document.flush();
			expect(normalizeText(node.data), JSON.stringify(text)).toBe('Té fresco');
		}
	});

	it('embeds its translations as data, never as code', () => {
		const script = overlayScript('es', [['</script><script>alert(1)</script>', '"); alert(2); ("'], ['a b', 'c']]);
		expect(script).not.toContain('<script>');
		const { document, main } = pageWithOverlay([['"); alert(2); ("', 'safe']], '"); alert(2); ("');
		expect(main.textContent).toBe('safe');
		expect(document.writes).toEqual(['text:safe']);
	});
});
