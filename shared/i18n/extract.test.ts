import { describe, expect, it } from 'vitest';
import { extractMessages, findUntranslatedText, messagesOfFiles, parseSource, visitNodes } from './extract';

/** The keys found in a fixture, in source order. */
function keys(source: string, file = 'a.tsx'): string[] {
	return extractMessages(source, file).messages.map((message) => message.key);
}

/** The calls in a fixture that the extractor could not read, as `line call: reason`. */
function skipped(source: string, file = 'a.tsx'): string[] {
	return extractMessages(source, file).skipped.map((call) => `${call.line} ${call.call}: ${call.reason}`);
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
		const { messages: found } = extractMessages(`const a = 1;\n\nconst b = t('Second');\n`, 'src/x.ts');
		expect(found).toEqual([{ key: 'Second', file: 'src/x.ts', line: 3 }]);
	});

	it('finds the server form, with the locale first', () => {
		expect(keys(`t(locale, 'Saved'); t(locale, 'Hi {name}', { name });`, 'a.ts')).toEqual(['Saved', 'Hi {name}']);
		expect(keys(`t('es', 'Saved');`, 'a.ts')).toEqual(['Saved']);
	});

	it('finds tn() as a plural keyed by singular and plural', () => {
		const [found] = extractMessages(`tn('{count} credit', '{count} credits', count);`, 'a.ts').messages;
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

	it('leaves out a variable, a member or a call, without complaint: t(identifier) is legal', () => {
		const source = [
			'const label = t(name);',
			'const a = t(LABELS[status]);',
			'const b = t(getLabel());',
			'const c = t(item.label, { item });',
			'const d = tn(one, other, n);',
			'const e = msg(text);',
			'const f = t(locale, name, { name });',
			"const g = t('');",
			'const h = <T text={label} />;',
			'const i = <T />;',
		].join('\n');
		expect(extractMessages(source, 'a.tsx')).toEqual({ messages: [], skipped: [] });
	});

	it('takes both branches of a condition, and both sides of a fallback', () => {
		expect(keys(`t(busy ? 'Saving…' : 'Save');`, 'a.ts')).toEqual(['Saving…', 'Save']);
		expect(keys(`t(a ? 'One' : b ? 'Two' : 'Three');`, 'a.ts')).toEqual(['One', 'Two', 'Three']);
		expect(keys(`t(name || 'Untitled'); t(note ?? 'No note'); msg(ok && 'Fine');`, 'a.ts')).toEqual(['Untitled', 'No note', 'Fine']);
		expect(keys(`t(locale, busy ? 'Saving…' : 'Save', { n });`, 'a.ts')).toEqual(['Saving…', 'Save']);
		expect(keys(`t(busy ? 'Hi {name}' : 'Bye {name}', { name });`, 'a.ts')).toEqual(['Hi {name}', 'Bye {name}']);
		expect(keys(`msg(ok ? 'Yes' : 'No');`, 'a.ts')).toEqual(['Yes', 'No']);
		expect(keys(`<T text={busy ? 'Saving <b>now</b>' : 'Save'} />`)).toEqual(['Saving <b>now</b>', 'Save']);
	});

	it('reads the condition of a branch only for its branches, not its test', () => {
		expect(keys(`t(mode === 'Fast mode' ? 'Quick' : 'Slow');`, 'a.ts')).toEqual(['Quick', 'Slow']);
	});

	it('reports a template literal with expressions, which can never match a catalog key', () => {
		const source = [
			'const a = t(`Hello ${name}`);',
			'const b = t(locale, `Hello ${name}`, { name });',
			'const c = msg(`Hello ${name}`);',
			'const d = <T text={`Hello ${name}`} />;',
			'const e = tn(`${n} credit`, `${n} credits`, n);',
		].join('\n');
		expect(skipped(source)).toEqual([
			'1 t: a template literal with expressions',
			'2 t: a template literal with expressions',
			'3 msg: a template literal with expressions',
			'4 T: a template literal with expressions',
			'5 tn: forms that are not both literals',
		]);
		expect(keys(source)).toEqual([]);
	});

	it('reports a concatenation, with strings or not', () => {
		const source = ["t('Hello ' + name);", 'msg(a + b);', "<T text={'Hello ' + name} />;", "tn('{count} ' + noun, '{count} nouns', n);"].join('\n');
		expect(skipped(source)).toEqual(['1 t: a concatenation', '2 msg: a concatenation', '3 T: a concatenation', '4 tn: forms that are not both literals']);
	});

	it('reads the literal branch of a condition that has a template in the other', () => {
		expect(keys('t(a ? `Hi ${name}` : \'Hi\');', 'a.ts')).toEqual(['Hi']);
		expect(skipped('t(a ? `Hi ${name}` : \'Hi\');', 'a.ts')).toEqual(['1 t: a template literal with expressions']);
	});

	it('reports a plural whose two forms are not both literals, but not one that is all variables', () => {
		const source = ["tn('{count} credit', PLURAL, n);", "tn(SINGULAR, '{count} credits', n);", "tn(a ? '{count} x' : '{count} y', '{count} z', n);", 'tn(SINGULAR, PLURAL, n);'].join('\n');
		expect(skipped(source)).toEqual(['1 tn: forms that are not both literals', '2 tn: forms that are not both literals', '3 tn: forms that are not both literals']);
	});

	it('finds a call with type arguments', () => {
		expect(keys(`const a = t<string>('Typed'); const b = tn<string>('{count} one', '{count} many', n);`, 'a.ts')).toEqual(['Typed', '{count} one|{count} many']);
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
		expect(extractMessages('this is {{ not valid <<< code', 'a.ts')).toEqual({ messages: [], skipped: [] });
	});

	it('names the file when a candidate does not parse', () => {
		expect(() => extractMessages(`t('ok'); const = ;`, 'src/broken.ts')).toThrow(/src\/broken\.ts/);
	});
});

describe('messagesOfFiles', () => {
	it('extracts from every file and drops the leading slash of a glob path', () => {
		const files = { '/src/a.ts': `t('A');`, '/src/b.ts': 'const nothing = 1;', 'worker/c.ts': `msg('C'); t(\`Hi ${'$'}{name}\`);` };
		const { messages, skipped } = messagesOfFiles(files);
		expect(messages.map(({ key, file }) => `${file}: ${key}`)).toEqual(['src/a.ts: A', 'worker/c.ts: C']);
		expect(skipped.map(({ file, line, call }) => `${file}:${line} ${call}`)).toEqual(['worker/c.ts:1 t']);
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

	it('does not flag code that is not text: a single word, lowercase text, a comparison to a word', () => {
		const source = `const a = 'hello world'; const b = { label: 'Save', title: 'Home' }; throw new Error('nope'); console.log('Debug');
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

	describe('English in code', () => {
		it('flags an object value, whatever its key', () => {
			const source = `export const ITEMS = [{ label: 'Add a product', description: 'Sells it in your store.', title: 'New product', error: "Couldn't load it" }];`;
			expect(untranslated(source, 'a.ts')).toEqual(['Add a product', 'Sells it in your store.', 'New product', "Couldn't load it"]);
		});

		it('flags the fallback passed to a helper', () => {
			expect(untranslated(`const data = unwrap(response, "Couldn't save your store.");`, 'a.ts')).toEqual(["Couldn't save your store."]);
		});

		it('flags the message of an error', () => {
			expect(untranslated(`throw new Error('Something went wrong.'); const e = Error('Try again later');`, 'a.ts')).toEqual(['Something went wrong.', 'Try again later']);
		});

		it('flags a native dialog', () => {
			expect(untranslated(`if (window.confirm('Delete this draft?')) {} alert('Saved!');`, 'a.ts')).toEqual(['Delete this draft?', 'Saved!']);
		});

		it('flags an exported message constant, and a message in state', () => {
			const source = `export const CHECKOUT_FAILED = 'Checkout failed. Try again.';\nconst [error, setError] = useState('Not connected yet');\nsetError('Could not connect: try again');`;
			expect(untranslated(source)).toEqual(['Checkout failed. Try again.', 'Not connected yet', 'Could not connect: try again']);
		});

		it('flags the fixed text of a template literal, where it starts like a sentence', () => {
			const source = 'const a = `Could not save ${name}.`;\nconst b = `Saved ${count} items`;\nconst c = `${name} is ready.`;\nconst d = `${a}${b}`;';
			expect(untranslated(source, 'a.ts')).toEqual(['Could not save ${name}.', 'Saved ${count} items']);
		});

		it('flags a literal in a condition, a fallback or a concatenation that is shown', () => {
			const source = `const a = ok ? 'All good here' : 'Not so good'; const b = name || 'Nobody is here'; const c = 'Hello there, ' + name;`;
			expect(untranslated(source, 'a.ts')).toEqual(['All good here', 'Not so good', 'Nobody is here', 'Hello there,']);
		});

		it('flags a message in a function a non-text attribute holds', () => {
			expect(untranslated(`<button onClick={() => setError('Could not save.')}>{t('Save')}</button>`)).toEqual(['Could not save.']);
		});

		it('flags a value passed to t() in its values', () => {
			expect(untranslated(`t('Hi {name}', { name: 'Some Customer' });`, 'a.ts')).toEqual(['Some Customer']);
		});

		it('flags a sentence by its capital and a space, or by its capital and a closing mark', () => {
			const source = [
				"const a = ['Two words', 'Done.', 'Why?', 'Wow!', 'Loading…', 'Error:', 'Done. ', 'Ok.\\n'];",
				"const b = ['Save', 'Authorization', 'Content-Type', 'two words', 'save.', '1 item', ' items', '$49', 'USD', ''];",
			].join('\n');
			expect(untranslated(source, 'a.ts')).toEqual(['Two words', 'Done.', 'Why?', 'Wow!', 'Loading…', 'Error:', 'Done.', 'Ok.']);
		});

		it('reports each literal once, wherever more than one rule sees it', () => {
			const source = `<>
				<input placeholder="Search for stores" title={busy ? 'Working on it' : 'Ready to go'} />
				<p>{'Welcome back to Estori'}</p>
			</>;
			toast.error('Could not save.', { description: 'Try again in a moment.' });
			toast.add({ title: 'Saved your store.' });`;
			expect(untranslated(source)).toEqual(['Search for stores', 'Working on it', 'Ready to go', 'Welcome back to Estori', 'Could not save.', 'Try again in a moment.', 'Saved your store.']);
		});

		it('skips a line with an i18n-ignore comment', () => {
			const source = `const ITEMS = [\n\t// i18n-ignore\n\t{ label: 'Shown as is' },\n\t{ label: 'Not skipped' },\n];\nconst a = 'Also skipped'; // i18n-ignore`;
			expect(untranslated(source, 'a.ts')).toEqual(['Not skipped']);
		});

		describe('but not', () => {
			it('the source of an import or an export', () => {
				const source = `import a from 'Some module.js'; import type { B } from 'Another one'; export { c } from 'Third one'; export * from 'Fourth one'; const d = await import('Fifth one'); const e = require('Sixth one'); import f = require('Seventh one');`;
				expect(untranslated(source, 'a.ts')).toEqual([]);
			});

			it('a JSX attribute that is not text, however it is written', () => {
				const source = `<>
					<Button variant="Primary action" size={big ? 'Very big' : 'Small one'} className={cond ? 'Foo bar' : 'Baz qux'} />
					<input value="Some value here" aria-labelledby="Heading text" />
					<T text="Read the terms of use" />
					<T text={busy ? 'Saving the store.' : 'Save the store.'} />
				</>`;
				expect(untranslated(source)).toEqual([]);
			});

			it('an object key, however it is written', () => {
				const source = `const a = { 'Some key': 1, ['Computed key']: 2, 'Method name'() {} }; class B { 'Field name' = 1; 'Method key'() {} } interface C { 'Prop name': string; 'Method sig'(): void } enum D { 'Member name' = 1 } const e = a['Some key']; const f = a?.['Some key'];`;
				expect(untranslated(source, 'a.ts')).toEqual([]);
			});

			it('a TypeScript literal type', () => {
				const source = `type Mode = 'Some text.' | 'Other text'; function f(mode: 'Third one'): 'Fourth one' { return mode; } const x = y as 'Fifth one';`;
				expect(untranslated(source, 'a.ts')).toEqual([]);
			});

			it('the argument of t, tn and msg, whatever the branch', () => {
				const source = `t('Some text.'); tn('One thing.', 'Many things.', n); msg('Another text.'); t(locale, 'Server text.'); i18n.t('Member text.'); t(busy ? 'Busy text.' : 'Idle text.'); msg(name || 'Fallback text.');`;
				expect(untranslated(source, 'a.ts')).toEqual([]);
			});

			it('the argument of a console or logger call', () => {
				const source = [
					"console.log('Some text.'); console.error('Failed to load', error); console.warn('Careful now.');",
					"logger.info('Starting up the server.'); this.logger.warn('Slow request.'); this.logger().debug('Request received.');",
					"currentLogger.error('Could not parse: ' + body); GitHubService.logger.error(`Failed to fetch ${id}.`); deps.logger.info('Ready now.');",
					"log('Plain log line.'); logError('Another failure.'); this.getLog().info('From a getter.');",
				].join('\n');
				expect(untranslated(source, 'a.ts')).toEqual([]);
			});

			it('a template that is a tagged template, which is code', () => {
				expect(untranslated('const q = sql`SELECT id FROM users WHERE name = ${name}`; const s = css`Some thing`;', 'a.ts')).toEqual([]);
			});
		});

		it('still flags a call on something that only looks like a logger', () => {
			expect(untranslated(`catalog.error('Not a logger.'); login('Sign in please.'); notlog('Also not one.');`, 'a.ts')).toEqual(['Not a logger.', 'Sign in please.', 'Also not one.']);
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

	it('tells the visitor the node\'s ancestors, nearest last', () => {
		const seen: string[] = [];
		visitNodes(parseSource(`f('x');`, 'a.ts').program, (node, ancestors) => {
			if (node.type === 'StringLiteral') seen.push(ancestors.map((ancestor) => ancestor.type).join(' > '));
		});
		expect(seen).toEqual(['Program > ExpressionStatement > CallExpression']);
	});

	it('parses JSX only in .tsx files', () => {
		expect(() => parseSource('const a = <p>x</p>;', 'a.tsx')).not.toThrow();
		expect(() => parseSource('const a = <p>x</p>;', 'a.ts')).toThrow(/a\.ts/);
	});
});
