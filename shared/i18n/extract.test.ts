import { describe, expect, it } from 'vitest';
import { extractMessages, findUntranslatedText, messagesOfFiles, parseSource, visitNodes } from './extract';

/** The keys found in a fixture, in source order. */
function keys(source: string, file = 'a.tsx'): string[] {
	return extractMessages(source, file).map((message) => message.key);
}

/** The texts reported for a fixture, in source order. */
function untranslated(source: string, file = 'a.tsx'): string[] {
	return findUntranslatedText(source, file).map((hit) => hit.text);
}

describe('extractMessages', () => {
	it('finds t() with a literal, with and without values', () => {
		expect(keys(`t('Save card'); t('Renews on {date}', { date });`)).toEqual(['Save card', 'Renews on {date}']);
	});

	it('records the file and the line of each call', () => {
		const found = extractMessages(`const a = 1;\n\nconst b = t('Second');\n`, 'src/x.ts');
		expect(found).toEqual([{ key: 'Second', file: 'src/x.ts', line: 3 }]);
	});

	it('finds the server form, with the locale first', () => {
		expect(keys(`t(locale, 'Saved'); t(locale, 'Hi {name}', { name });`, 'a.ts')).toEqual(['Saved', 'Hi {name}']);
		expect(keys(`t('es', 'Saved');`, 'a.ts')).toEqual(['Saved']);
	});

	it('finds tn() as a plural keyed by singular and plural', () => {
		const [found] = extractMessages(`tn('{count} credit', '{count} credits', count);`, 'a.ts');
		expect(found.key).toBe('{count} credit|{count} credits');
		expect(found.plural).toEqual({ singular: '{count} credit', plural: '{count} credits' });
	});

	it('finds tn() with values, a literal count, and the server form', () => {
		expect(keys(`tn('{count} store', '{count} stores', 1, { name });`, 'a.ts')).toEqual(['{count} store|{count} stores']);
		expect(keys(`tn(locale, '{count} store', '{count} stores', n);`, 'a.ts')).toEqual(['{count} store|{count} stores']);
		expect(keys(`tn('es', '{count} store', '{count} stores', 2);`, 'a.ts')).toEqual(['{count} store|{count} stores']);
	});

	it('finds msg()', () => {
		expect(keys(`const FAILED = msg('Something went wrong.');`, 'a.ts')).toEqual(['Something went wrong.']);
	});

	it('finds <T text="..." />, as an attribute string or an expression', () => {
		const source = `<>
			<T text="Read the <link>terms</link>" components={{ link: (c) => <a>{c}</a> }} />
			<T text={'Hello {name}'} values={{ name }} />
			<T text={\`Plain\`} />
		</>`;
		expect(keys(source)).toEqual(['Read the <link>terms</link>', 'Hello {name}', 'Plain']);
	});

	it('counts a template literal with no expressions as a literal', () => {
		expect(keys('t(`Save card`); msg(`Gone`);', 'a.ts')).toEqual(['Save card', 'Gone']);
	});

	it('leaves out a non-literal argument', () => {
		const source = [
			'const label = t(name);',
			'const a = t(`Hello ${name}`);',
			"const b = t('a' + 'b');",
			'const c = tn(one, other, n);',
			"const d = tn('only one', other, n);",
			'const e = msg(text);',
			"const f = t(locale, name, { name });",
			"const g = t('');",
			'const h = <T text={label} />;',
			'const i = <T />;',
		].join('\n');
		expect(keys(source)).toEqual([]);
	});

	it('reads literals wrapped in TypeScript assertions', () => {
		expect(keys(`t('Save' as const); msg('Gone' satisfies string); t('Hi'!);`, 'a.ts')).toEqual(['Save', 'Gone', 'Hi']);
	});

	it('decodes escapes in the literal', () => {
		expect(keys(`t('It\\'s done'); t("Say \\"hi\\""); t('Line\\nbreak');`, 'a.ts')).toEqual(["It's done", 'Say "hi"', 'Line\nbreak']);
	});

	it('finds member calls: i18n.t, a bound translator and optional calls', () => {
		const source = `i18n.t('One'); serverT(locale).t('Two'); i18n?.t('Three'); i18n.tn('a', 'b', n); i18n.msg('Four');`;
		expect(keys(source, 'a.ts')).toEqual(['One', 'Two', 'Three', 'a|b', 'Four']);
	});

	it('finds a call inside another call and inside JSX', () => {
		const source = `<p title={t('Outer {x}', { x: t('Inner') })}>{t('Body')}</p>`;
		expect(keys(source)).toEqual(['Outer {x}', 'Inner', 'Body']);
	});

	it('returns messages in source order, one per call', () => {
		const source = `<div>{t('B')}<span>{t('A')}</span>{t('B')}</div>`;
		expect(keys(source)).toEqual(['B', 'A', 'B']);
	});

	it('ignores look-alikes: other functions, other components, types, comments and strings', () => {
		const source = [
			"format('x'); split('x'); get('x'); map.set('x'); regex.test('x'); trim('x'); Atn('x');",
			"const id = <Table text=\"x\" />; const trans = <Trans text=\"x\" />;",
			"// t('in a comment')",
			"/* msg('in a block') */",
			"const text = \"t('in a string')\";",
			"type Box<T> = { value: T }; const list: Array<T> = [];",
			"const generic = <T,>(value: T) => value;",
		].join('\n');
		expect(keys(source)).toEqual([]);
	});

	it('reads an angle-bracket assertion in a .ts file', () => {
		expect(keys(`const x = <string>value; t('Fine');`, 'a.ts')).toEqual(['Fine']);
	});

	it('does not parse a file that cannot hold a call', () => {
		expect(extractMessages('this is {{ not valid <<< code', 'a.ts')).toEqual([]);
	});

	it('names the file when a candidate does not parse', () => {
		expect(() => extractMessages(`t('ok'); const = ;`, 'src/broken.ts')).toThrow(/src\/broken\.ts/);
	});
});

describe('messagesOfFiles', () => {
	it('extracts from every file and drops the leading slash of a glob path', () => {
		const files = { '/src/a.ts': `t('A');`, '/src/b.ts': 'const nothing = 1;', 'worker/c.ts': `msg('C');` };
		expect(messagesOfFiles(files).map(({ key, file }) => `${file}: ${key}`)).toEqual(['src/a.ts: A', 'worker/c.ts: C']);
	});
});

describe('findUntranslatedText', () => {
	it('flags JSX text, with its file, line and text', () => {
		const found = findUntranslatedText(`const a = (\n\t<div>\n\t\t<p>Hello</p>\n\t</div>\n);`, 'src/x.tsx');
		expect(found).toEqual([{ file: 'src/x.tsx', line: 3, text: 'Hello' }]);
	});

	it('flags the text attributes', () => {
		const source = `<>
			<input placeholder="Search" />
			<button title="Close" aria-label="Close dialog" />
			<img alt="A shop" />
			<Field label="Name" description="Shown on your store" />
			<Hint message="Saved" tooltip="Copy" searchPlaceholder="Find" pageTitle="Home" />
		</>`;
		expect(untranslated(source)).toEqual([
			'Search',
			'Close',
			'Close dialog',
			'A shop',
			'Name',
			'Shown on your store',
			'Saved',
			'Copy',
			'Find',
			'Home',
		]);
	});

	it('flags a text attribute written as an expression, including both branches of a condition', () => {
		const source = `<>
			<input placeholder={'Search'} />
			<input placeholder={busy ? 'Working' : 'Ready'} />
			<input placeholder={\`Search \${what}\`} />
		</>`;
		expect(untranslated(source)).toEqual(['Search', 'Working', 'Ready', 'Search ${what}']);
	});

	it('flags literal toast messages', () => {
		const source = [
			"toast.error('Failed');",
			"toast.success('Saved');",
			"toast.warning('Careful');",
			"toast.info('FYI');",
			"toast.message('Note'); toast.loading('Working');",
			"toast('Plain');",
			'toast.error(`Could not save ${name}`);',
		].join('\n');
		expect(untranslated(source, 'a.ts')).toEqual(['Failed', 'Saved', 'Careful', 'FYI', 'Note', 'Working', 'Plain', 'Could not save ${name}']);
	});

	it('flags the title and description of a toast, in an options object', () => {
		const source = [
			"toast.add({ title: 'Saved', description: 'Your store is updated.', variant: 'success' });",
			"toast.error('Failed', { description: 'Try again.', duration: 3000 });",
			"toast.add({ 'title': 'Quoted' });",
		].join('\n');
		expect(untranslated(source, 'a.ts')).toEqual(['Saved', 'Your store is updated.', 'Failed', 'Try again.', 'Quoted']);
	});

	it('flags text in an expression container: literals, conditions, fallbacks and concatenation', () => {
		const source = `<>
			<p>{'Hello'}</p>
			<Button>{busy ? 'Saving…' : 'Save'}</Button>
			<span>{name || 'Untitled'}</span>
			<span>{count + ' items'}</span>
			<span>{\`Hello \${name}\`}</span>
		</>`;
		expect(untranslated(source)).toEqual(['Hello', 'Saving…', 'Save', 'Untitled', 'items', 'Hello ${name}']);
	});

	it('flags text around elements, and in fragments', () => {
		expect(untranslated(`<div><span>Hi</span> there <b>you</b></div>`)).toEqual(['Hi', 'there', 'you']);
		expect(untranslated(`<>Fragment text</>`)).toEqual(['Fragment text']);
	});

	it('flags toasts in plain .ts files', () => {
		expect(untranslated(`export const notify = () => toast.error('Failed');`, 'src/notify.ts')).toEqual(['Failed']);
	});

	it('reports the line where multi-line text starts, with its whitespace collapsed', () => {
		const source = `const a = (\n\t<p>\n\n\t\tFirst line\n\t\tsecond   line\n\t</p>\n);`;
		expect(findUntranslatedText(source, 'a.tsx')).toEqual([{ file: 'a.tsx', line: 4, text: 'First line second line' }]);
	});

	it('reports in source order', () => {
		const source = `<div title="Z">\n\t<p>A</p>\n\t{busy ? 'M' : 'N'}\n</div>`;
		expect(findUntranslatedText(source, 'a.tsx').map(({ line, text }) => `${line}:${text}`)).toEqual(['1:Z', '2:A', '3:M', '3:N']);
	});

	it('does not flag text that is already translated', () => {
		const source = `<>
			<p>{t('Hello')}</p>
			<input placeholder={t('Search')} title={t('Find')} aria-label={t('Search')} />
			<T text="Read the <link>terms</link>" />
			<T text="Hello" />
		</>`;
		expect(untranslated(source)).toEqual([]);
		const toasts = `toast.error(t('Failed')); toast.success(msg('Saved')); toast.error(message); toast(CHANGE_SLOW); toast.error(error.message);`;
		expect(untranslated(toasts, 'a.ts')).toEqual([]);
	});

	it('does not flag a variable, a number, whitespace, punctuation or an entity', () => {
		const source = `<>
			<p>{count}</p>
			<p>{user.name}</p>
			<p>{items.length} </p>
			<p>   </p>
			<p>
			</p>
			<p>{' '}</p>
			<p>—</p>
			<p>/</p>
			<p>|</p>
			<p>...</p>
			<p>…</p>
			<p>42</p>
			<p>1,000.50</p>
			<p>$49</p>
			<p>#1</p>
			<p>&nbsp;</p>
			<p>&amp;</p>
			<p>&copy; &middot;</p>
			<p>{'  '}</p>
			<p>{'→'}</p>
			<p>{count + 1}</p>
			<p>{\`\${a}\${b}\`}</p>
			<input placeholder="" alt="" title={''} />
		</>`;
		expect(untranslated(source)).toEqual([]);
	});

	it('does not flag attributes that are not text', () => {
		const source = `<a className="btn primary" href="/home" id="main" type="button" key="k" data-testid="the thing" role="button" target="_blank" rel="noopener noreferrer" htmlFor="name" to="/settings" variant="secondary" size="sm" style={{ color: 'red' }}>{t('Home')}</a>`;
		expect(untranslated(source)).toEqual([]);
	});

	it('does not flag strings outside text positions', () => {
		const source = `const a = 'Hello world'; const b = { label: 'Save', title: 'Home' }; throw new Error('Nope'); console.log('Debug');
			const c = cond ? 'yes' : 'no'; function f() { return <p>{c}</p>; }`;
		expect(untranslated(source)).toEqual([]);
	});

	it('does not flag a method of another object named like a toast method', () => {
		expect(untranslated(`logger.error('Failed'); console.info('Done'); notify.success('Ok'); toaster.error('Nope');`, 'a.ts')).toEqual([]);
	});

	describe('i18n-ignore', () => {
		it('skips the line below a // comment', () => {
			const source = `<input\n\t// i18n-ignore\n\tplaceholder="Search"\n\ttitle="Close"\n/>`;
			expect(untranslated(source)).toEqual(['Close']);
		});

		it('skips the line below a JSX comment', () => {
			const source = `<div>\n\t{/* i18n-ignore */}\n\t<code>npm install</code>\n\t<p>Hello</p>\n</div>`;
			expect(untranslated(source)).toEqual(['Hello']);
		});

		it('skips text that starts on the line below a JSX comment', () => {
			const source = `<p>\n\t{/* i18n-ignore */}\n\tEstori\n</p>`;
			expect(untranslated(source)).toEqual([]);
		});

		it('skips the line it trails', () => {
			const source = `<div>\n\t<code>npm run dev</code> {/* i18n-ignore */}\n\t<p>Hello</p>\n</div>`;
			expect(untranslated(source)).toEqual(['Hello']);
			expect(untranslated(`toast.error('Failed'); // i18n-ignore\ntoast.error('Again');`, 'a.ts')).toEqual(['Again']);
		});

		it('skips a toast written over several lines, from above its first line', () => {
			const source = `// i18n-ignore\ntoast.error(\n\t'Failed',\n);\ntoast.error('Next');`;
			expect(untranslated(source, 'a.ts')).toEqual(['Next']);
		});

		it('skips only the one line, not a blank line or what follows', () => {
			const source = `<div>\n\t{/* i18n-ignore */}\n\n\t<p>Gap</p>\n\t<p>Next</p>\n</div>`;
			expect(untranslated(source)).toEqual(['Gap', 'Next']);
		});

		it('accepts a reason after the marker', () => {
			const source = `<div>\n\t{/* i18n-ignore: brand name */}\n\t<b>Estori</b>\n</div>`;
			expect(untranslated(source)).toEqual([]);
		});

		it('is not fooled by a comment that merely mentions it', () => {
			const source = `<div>\n\t{/* we do not i18n-ignore this */}\n\t<p>Hello</p>\n</div>`;
			expect(untranslated(source)).toEqual(['Hello']);
		});
	});

	it('names the file when the source does not parse', () => {
		expect(() => findUntranslatedText('const = ;', 'src/broken.tsx')).toThrow(/src\/broken\.tsx/);
	});
});

describe('parseSource and visitNodes', () => {
	it('walks every node in a file, without comments or locations', () => {
		const types: string[] = [];
		visitNodes(parseSource(`// note\nconst a = f('x');`, 'a.ts').program, (node) => types.push(node.type));
		expect(types).toEqual(['Program', 'VariableDeclaration', 'VariableDeclarator', 'Identifier', 'CallExpression', 'Identifier', 'StringLiteral']);
	});

	it('parses JSX only in .tsx files', () => {
		expect(() => parseSource('const a = <p>x</p>;', 'a.tsx')).not.toThrow();
		expect(() => parseSource('const a = <p>x</p>;', 'a.ts')).toThrow(/a\.ts/);
	});
});
