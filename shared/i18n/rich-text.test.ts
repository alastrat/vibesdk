import { describe, expect, it } from 'vitest';
import { parseRichText, tagsOf } from './rich-text';

describe('parseRichText', () => {
	it('splits text around a tag', () => {
		expect(parseRichText('Read the <link>Terms</link>.')).toEqual(['Read the ', { tag: 'link', children: ['Terms'] }, '.']);
	});

	it('returns plain text as a single part, and nothing for nothing', () => {
		expect(parseRichText('No tags here')).toEqual(['No tags here']);
		expect(parseRichText('')).toEqual([]);
	});

	it('handles a tag at either end and several in a row', () => {
		expect(parseRichText('<b>Bold</b>')).toEqual([{ tag: 'b', children: ['Bold'] }]);
		expect(parseRichText('<a>one</a> and <b>two</b>')).toEqual([
			{ tag: 'a', children: ['one'] },
			' and ',
			{ tag: 'b', children: ['two'] },
		]);
	});

	it('nests tags', () => {
		expect(parseRichText('See <link>the <b>full</b> terms</link> now')).toEqual([
			'See ',
			{ tag: 'link', children: ['the ', { tag: 'b', children: ['full'] }, ' terms'] },
			' now',
		]);
	});

	it('nests tags that share a name', () => {
		expect(parseRichText('<b>a <b>b</b> c</b>')).toEqual([{ tag: 'b', children: ['a ', { tag: 'b', children: ['b'] }, ' c'] }]);
	});

	it('keeps an empty tag', () => {
		expect(parseRichText('a<b></b>c')).toEqual(['a', { tag: 'b', children: [] }, 'c']);
	});

	it('leaves an unclosed tag as plain text', () => {
		expect(parseRichText('Read the <link>Terms')).toEqual(['Read the <link>Terms']);
		expect(parseRichText('<a>one <b>two</b>')).toEqual(['<a>one ', { tag: 'b', children: ['two'] }]);
	});

	it('leaves a closing tag with no opener as plain text', () => {
		expect(parseRichText('Terms</link> apply')).toEqual(['Terms</link> apply']);
		expect(parseRichText('<a>x</b></a>')).toEqual([{ tag: 'a', children: ['x</b>'] }]);
	});

	it('treats tags crossed over each other as plain text for the one left open', () => {
		expect(parseRichText('<a>x<b>y</a>z</b>')).toEqual([{ tag: 'a', children: ['x<b>y'] }, 'z</b>']);
	});

	it('leaves anything that is not a bare tag as plain text', () => {
		expect(parseRichText('1 < 2 and 3 > 2')).toEqual(['1 < 2 and 3 > 2']);
		expect(parseRichText('<3 you')).toEqual(['<3 you']);
		expect(parseRichText('<a href="x">link</a>')).toEqual(['<a href="x">link</a>']);
		expect(parseRichText('line<br/>break')).toEqual(['line<br/>break']);
		expect(parseRichText('<>x</>')).toEqual(['<>x</>']);
	});

	it('reads placeholders that were filled in before parsing as text', () => {
		expect(parseRichText('Renews on <b>May 1</b>, {unfilled}')).toEqual(['Renews on ', { tag: 'b', children: ['May 1'] }, ', {unfilled}']);
	});
});

describe('tagsOf', () => {
	it('lists the bare tags, openers and closers, each once, in order of first use', () => {
		expect(tagsOf('<b>Bold</b> and <i>italic</i> and <b>bold</b>')).toEqual(['<b>', '</b>', '<i>', '</i>']);
	});

	it('reads the same tags parseRichText does, and nothing else', () => {
		expect(tagsOf('1 < 2 and 3 > 2, <3, <a href="x">, <br/>, <>')).toEqual([]);
		expect(tagsOf('<my-tag>x</my-tag>')).toEqual(['<my-tag>', '</my-tag>']);
		expect(tagsOf('plain text')).toEqual([]);
	});
});
