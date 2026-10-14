import type { EmailSender, OutgoingEmail } from '../../services/email/types';

export type Row = Record<string, unknown>;
export type Statement = { sql: string; params: unknown[] };

/** The column names drizzle selected, so a fake row can be laid out whatever order the service asks for. */
export function selectedColumns(sql: string): string[] {
	const list = sql.slice('select '.length, sql.indexOf(' from '));
	return list.split(', ').map((part) => (part.split('.').pop() ?? '').replace(/"/g, ''));
}

/** Rows to return for a select, by table name; a table without a row selects nothing. */
export function rowsByTable(tables: Record<string, Row | undefined>): (sql: string) => unknown[][] {
	return (sql) => {
		const lower = sql.toLowerCase();
		if (!lower.startsWith('select ')) return [];
		for (const [table, row] of Object.entries(tables)) {
			if (row && lower.includes(`from "${table}"`)) {
				return [selectedColumns(lower).map((column) => row[column] ?? null)];
			}
		}
		return [];
	};
}

type WriteVerb = 'insert' | 'update' | 'delete';

const WRITE_PREFIX: Record<WriteVerb, string> = { insert: 'insert into', update: 'update', delete: 'delete from' };

export function writes(statements: Statement[], verb: WriteVerb, table: string): Statement[] {
	const prefix = `${WRITE_PREFIX[verb]} "${table}"`;
	return statements.filter((entry) => entry.sql.toLowerCase().startsWith(prefix));
}

export function lastWrite(statements: Statement[], verb: WriteVerb, table: string): Statement {
	const found = writes(statements, verb, table).at(-1);
	if (!found) throw new Error(`No ${verb} on ${table}`);
	return found;
}

/**
 * The value an insert or update writes to each column, by column name. Placeholders take their bound
 * parameter; literals such as `null` are kept as written.
 */
export function assignedValues(statement: Statement): Record<string, unknown> {
	const sql = statement.sql;
	const lower = sql.toLowerCase();
	const params = [...statement.params];
	const take = (expression: string): unknown => (expression === '?' ? params.shift() : expression);
	const values: Record<string, unknown> = {};

	if (lower.startsWith('insert into ')) {
		const columns = sql.slice(sql.indexOf('(') + 1, lower.indexOf(') values (')).split(', ');
		const expressions = sql.slice(lower.indexOf(') values (') + ') values ('.length, sql.lastIndexOf(')')).split(', ');
		columns.forEach((column, index) => {
			values[column.replace(/"/g, '')] = take(expressions[index]);
		});
		return values;
	}

	if (lower.startsWith('update ')) {
		const start = lower.indexOf(' set ') + ' set '.length;
		const whereAt = lower.indexOf(' where ');
		const assignments = sql.slice(start, whereAt === -1 ? undefined : whereAt).split(', ');
		for (const assignment of assignments) {
			const [column, expression] = assignment.split(' = ');
			values[column.replace(/"/g, '')] = take(expression);
		}
		return values;
	}

	throw new Error(`Not an insert or update: ${sql}`);
}

export async function rejection(promise: Promise<unknown>): Promise<unknown> {
	try {
		await promise;
	} catch (error) {
		return error;
	}
	throw new Error('Expected the promise to reject');
}

export function recordingSender(): { sender: EmailSender; sent: OutgoingEmail[] } {
	const sent: OutgoingEmail[] = [];
	return {
		sent,
		sender: {
			async send(email) {
				sent.push(email);
			},
		},
	};
}

/** The raw token in the first link of an email's text version. */
export function tokenFromEmail(email: OutgoingEmail): string {
	const link = email.text.match(/https?:\/\/\S+/)?.[0];
	const token = link ? new URL(link).searchParams.get('token') : null;
	if (!token) throw new Error('No token link in the email');
	return token;
}
