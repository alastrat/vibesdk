/**
 * Brings the translation catalogs up to date with the source: finds every message marked with `t`, `tn`, `msg` or
 * `<T>`, adds the ones a catalog lacks with a blank translation, and sorts the keys. Translations already in a catalog
 * are never changed, and keys no source uses are listed but kept, unless `--prune` is given.
 *   bun run i18n:extract            update the catalogs, then list what still needs a translation
 *   bun run i18n:extract --prune    also delete the keys no source uses
 * A message that can't be read (a template literal with expressions, a concatenation) is listed and fails the run.
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkCatalog, describeMessage, describeSkipped, serializeCatalog, syncCatalog, usedMessages, type CatalogReport, type CatalogSync } from '../shared/i18n/catalog-check';
import { messagesOfFiles, type SkippedMessage } from '../shared/i18n/extract';
import { DEFAULT_LOCALE, LOCALES } from '../shared/i18n/locales';

/** The folders scanned. `shared/i18n/i18n-catalogs.test.ts` scans the same files, so the two agree on what is used. */
const SOURCE_FOLDERS = ['src', 'shared', 'worker'];

/** A long list is cut here, so one run's summary stays readable. */
const LIST_LIMIT = 25;

export interface Options {
	prune: boolean;
}

export function parseOptions(argv: readonly string[]): Options {
	const unknown = argv.filter((argument) => argument !== '--prune');
	if (unknown.length > 0) throw new Error(`Unknown option: ${unknown.join(' ')}\nUsage: bun run i18n:extract [--prune]`);
	return { prune: argv.includes('--prune') };
}

function isSourceFile(file: string): boolean {
	return /\.tsx?$/.test(file) && !/\.(test|spec)\.tsx?$/.test(file) && !file.split('/').includes('node_modules');
}

function sourceFiles(root: string): string[] {
	const files = SOURCE_FOLDERS.flatMap((folder) =>
		readdirSync(path.join(root, folder), { recursive: true, encoding: 'utf8' }).map((file) => `${folder}/${file.split(path.sep).join('/')}`),
	);
	return files.filter(isSourceFile).sort();
}

function readCatalog(file: string): Record<string, unknown> {
	const catalog: unknown = JSON.parse(readFileSync(file, 'utf8'));
	if (typeof catalog !== 'object' || catalog === null || Array.isArray(catalog)) throw new Error(`${file} must hold a JSON object`);
	return Object.fromEntries(Object.entries(catalog));
}

function listed(items: readonly string[]): string[] {
	const shown = items.slice(0, LIST_LIMIT).map((item) => `    ${item}`);
	return items.length > LIST_LIMIT ? [...shown, `    ... and ${items.length - LIST_LIMIT} more`] : shown;
}

/** What one catalog's run did and what is left to do; `report` is of the catalog after the run. */
export function summaryLines(name: string, sync: CatalogSync, report: CatalogReport, options: Options): string[] {
	const problems = [...report.badShape, ...report.mismatched];
	const parts = [
		sync.added.length > 0 ? `${sync.added.length} added` : '',
		report.empty.length > 0 ? `${report.empty.length} to translate` : '',
		sync.unused.length > 0 ? `${sync.unused.length} unused, ${options.prune ? 'removed' : 'kept (--prune removes them)'}` : '',
		problems.length > 0 ? `${problems.length} to fix` : '',
	].filter((part) => part !== '');
	if (parts.length === 0) return [`${name}: up to date`];
	return [
		`${name}: ${parts.join(', ')}`,
		...(report.empty.length > 0 ? ['  to translate:', ...listed(report.empty.map(describeMessage))] : []),
		...(sync.unused.length > 0 ? ['  unused:', ...listed(sync.unused.map((key) => JSON.stringify(key)))] : []),
		...(problems.length > 0 ? ['  to fix:', ...listed(problems)] : []),
	];
}

/** The calls whose message could not be read, which no catalog can translate; empty when there are none. */
export function skippedLines(skipped: readonly SkippedMessage[]): string[] {
	return skipped.length > 0 ? ['not read:', ...listed(skipped.map(describeSkipped))] : [];
}

function main(): void {
	const options = parseOptions(process.argv.slice(2));
	const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
	const files = sourceFiles(root);
	const { messages: extracted, skipped } = messagesOfFiles(Object.fromEntries(files.map((file) => [file, readFileSync(path.join(root, file), 'utf8')])));
	const messages = usedMessages(extracted);
	console.log(`Scanned ${files.length} files: ${messages.length} messages, ${messages.filter((message) => message.plural).length} of them plurals`);

	for (const locale of LOCALES.filter((candidate) => candidate !== DEFAULT_LOCALE)) {
		const file = path.join(root, 'shared', 'i18n', 'catalogs', `${locale}.json`);
		const sync = syncCatalog(messages, readCatalog(file), options);
		const text = serializeCatalog(sync.catalog);
		if (text !== readFileSync(file, 'utf8')) writeFileSync(file, text);
		for (const line of summaryLines(`${locale}.json`, sync, checkCatalog(messages, sync.catalog), options)) console.log(line);
	}
	for (const line of skippedLines(skipped)) console.error(line);
	if (skipped.length > 0) process.exitCode = 1;
}

// process.argv can be undefined in the Workers test pool, so guard each access.
if (process.argv?.[1]?.endsWith('i18n-extract.ts')) {
	try {
		main();
	} catch (error: unknown) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
