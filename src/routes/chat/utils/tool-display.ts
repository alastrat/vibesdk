import { msg, t, tn } from '@/lib/i18n';
import type { ToolEvent } from './message-helpers';

function asString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim().length > 0
		? value.trim()
		: undefined;
}

function pickString(
	args: Record<string, unknown> | undefined,
	...keys: string[]
): string | undefined {
	if (!args) return undefined;
	for (const key of keys) {
		const value = asString(args[key]);
		if (value) return value;
	}
	return undefined;
}

function pickStringArray(
	args: Record<string, unknown> | undefined,
	...keys: string[]
): string[] {
	if (!args) return [];
	for (const key of keys) {
		const value = args[key];
		if (Array.isArray(value)) {
			return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
		}
		const single = asString(value);
		if (single) return [single];
	}
	return [];
}

/** Shorten a path for display: keep last 2 segments when long. */
export function shortenPath(path: string, max = 42): string {
	const normalized = path.replace(/\\/g, '/');
	if (normalized.length <= max) return normalized;
	const parts = normalized.split('/').filter(Boolean);
	if (parts.length <= 2) {
		return `…${normalized.slice(-(max - 1))}`;
	}
	const tail = parts.slice(-2).join('/');
	return tail.length + 2 <= max ? `…/${tail}` : `…${tail.slice(-(max - 1))}`;
}

function quote(value: string, max = 48): string {
	const trimmed = value.length > max ? `${value.slice(0, max - 1)}…` : value;
	return `"${trimmed}"`;
}

function pathLabel(path: string | undefined): string {
	return path ? shortenPath(path) : t('file');
}

export function pickToolPath(args?: Record<string, unknown>): string | undefined {
	return pickString(args, 'path', 'filePath', 'file');
}

export function pickToolPaths(args?: Record<string, unknown>): string[] {
	const multi = pickStringArray(args, 'paths');
	if (multi.length > 0) return multi;
	const single = pickToolPath(args);
	return single ? [single] : [];
}

type VerbSet = { start: string; success: string; error: string };

/** The verbs a tool row shows, marked as messages and translated where they are shown (see `verbFor`). */
const VERBS: Record<string, VerbSet> = {
	read: { start: msg('Reading'), success: msg('Read'), error: msg('Failed to read') },
	write: { start: msg('Writing'), success: msg('Wrote'), error: msg('Failed to write') },
	edit: { start: msg('Editing'), success: msg('Edited'), error: msg('Failed to edit') },
	delete: { start: msg('Deleting'), success: msg('Deleted'), error: msg('Failed to delete') },
	list: { start: msg('Listing'), success: msg('Listed'), error: msg('Failed to list') },
	find: { start: msg('Finding'), success: msg('Found'), error: msg('Failed to find') },
	grep: { start: msg('Searching'), success: msg('Searched'), error: msg('Failed to search') },
	bash: { start: msg('Running'), success: msg('Ran'), error: msg('Failed to run') },
	commit: { start: msg('Committing'), success: msg('Committed'), error: msg('Failed to commit') },
	deploy_space: { start: msg('Deploying'), success: msg('Deployed'), error: msg('Failed to deploy') },
	deploy_preview: { start: msg('Deploying preview'), success: msg('Deployed preview'), error: msg('Failed to deploy preview') },
	set_title: { start: msg('Setting title'), success: msg('Set title'), error: msg('Failed to set title') },
	ask_questions: { start: msg('Asking'), success: msg('Asked'), error: msg('Failed to ask') },
	get_browser_console_logs: {
		start: msg('Checking browser console'),
		success: msg('Checked browser console'),
		error: msg('Failed to check browser console'),
	},
	activate_skill: { start: msg('Loading skill'), success: msg('Loaded skill'), error: msg('Failed to load skill') },
	web_search: { start: msg('Searching the web'), success: msg('Searched the web'), error: msg('Web search failed') },
	git: { start: msg('Running git'), success: msg('Ran git'), error: msg('Git failed') },
	read_files: { start: msg('Reading files'), success: msg('Read files'), error: msg('Failed to read files') },
	regenerate_file: { start: msg('Regenerating'), success: msg('Regenerated'), error: msg('Failed to regenerate') },
	generate_files: { start: msg('Generating files'), success: msg('Generated files'), error: msg('Failed to generate files') },
	exec_commands: { start: msg('Running commands'), success: msg('Ran commands'), error: msg('Commands failed') },
	run_analysis: { start: msg('Analyzing'), success: msg('Analyzed'), error: msg('Analysis failed') },
	get_runtime_errors: { start: msg('Checking runtime errors'), success: msg('Checked runtime errors'), error: msg('Failed to check runtime errors') },
	get_logs: { start: msg('Fetching logs'), success: msg('Fetched logs'), error: msg('Failed to fetch logs') },
	deep_debug: { start: msg('Debugging'), success: msg('Finished debugging'), error: msg('Debugging failed') },
	queue_request: { start: msg('Queuing request'), success: msg('Queued request'), error: msg('Failed to queue request') },
	submit_feedback: { start: msg('Submitting feedback'), success: msg('Submitted feedback'), error: msg('Failed to submit feedback') },
	rename_project: { start: msg('Renaming project'), success: msg('Renamed project'), error: msg('Failed to rename project') },
	alter_blueprint: { start: msg('Updating blueprint'), success: msg('Updated blueprint'), error: msg('Failed to update blueprint') },
	wait_for_generation: { start: msg('Waiting for generation'), success: msg('Generation ready'), error: msg('Wait failed') },
	wait_for_debug: { start: msg('Waiting for debug'), success: msg('Debug ready'), error: msg('Wait failed') },
	wait: { start: msg('Waiting'), success: msg('Waited'), error: msg('Wait failed') },
	// Rows the chat adds itself, not tools the AI ran.
	conversation_reset: { start: msg('Resetting conversation'), success: msg('Conversation reset'), error: msg('Failed to reset conversation') },
	fetching_conversations: {
		start: msg('Fetching your latest conversations'),
		success: msg('Fetched your latest conversations'),
		error: msg('Failed to fetch your latest conversations'),
	},
};

/** The verb for a tool and its status. A tool with no entry shows its own name, which is code and stays as written. */
function verbFor(name: string, status: ToolEvent['status']): string {
	const set = VERBS[name];
	if (set) return t(set[status === 'start' ? 'start' : status === 'error' ? 'error' : 'success']);
	const pretty = name.replace(/_/g, ' ');
	if (status === 'start') return t('Running {tool}', { tool: pretty });
	if (status === 'error') return t('Failed {tool}', { tool: pretty });
	return pretty.charAt(0).toUpperCase() + pretty.slice(1);
}

function detailFor(name: string, args?: Record<string, unknown>): string | undefined {
	const path = pickToolPath(args);
	const paths = pickToolPaths(args);

	switch (name) {
		case 'read':
		case 'write':
		case 'edit':
		case 'delete':
		case 'list':
		case 'regenerate_file':
			return path ? pathLabel(path) : undefined;
		case 'read_files':
			if (paths.length === 1) return pathLabel(paths[0]);
			if (paths.length > 1) return tn('{count} file', '{count} files', paths.length);
			return undefined;
		case 'find': {
			const pattern = pickString(args, 'pattern', 'glob');
			return pattern ? pattern : undefined;
		}
		case 'grep': {
			const query = pickString(args, 'query', 'pattern', 'search');
			const include = pickString(args, 'include');
			if (query && include) return t('{query} in {include}', { query: quote(query), include });
			if (query) return quote(query);
			return undefined;
		}
		case 'bash':
		case 'exec_commands': {
			const script = pickString(args, 'script', 'command');
			if (script) return quote(script, 40);
			const commands = pickStringArray(args, 'commands');
			if (commands.length === 1) return quote(commands[0], 40);
			if (commands.length > 1) return tn('{count} command', '{count} commands', commands.length);
			return undefined;
		}
		case 'commit': {
			const message = pickString(args, 'message');
			return message ? quote(message, 40) : undefined;
		}
		case 'git': {
			const command = pickString(args, 'command');
			const message = pickString(args, 'message');
			if (command === 'commit' && message) return `commit ${quote(message, 32)}`;
			return command;
		}
		case 'set_title':
		case 'rename_project': {
			const title = pickString(args, 'title', 'newName', 'name');
			return title ? quote(title, 40) : undefined;
		}
		case 'web_search': {
			const query = pickString(args, 'query');
			const url = pickString(args, 'url');
			if (query) return quote(query, 40);
			if (url) return shortenPath(url, 40);
			return undefined;
		}
		case 'activate_skill': {
			const skill = pickString(args, 'skill', 'name', 'id', 'skill_id');
			return skill;
		}
		case 'ask_questions': {
			const questions = args?.questions;
			if (Array.isArray(questions) && questions.length > 0) {
				return tn('{count} question', '{count} questions', questions.length);
			}
			return undefined;
		}
		case 'get_browser_console_logs': {
			const url = pickString(args, 'url');
			return url ? shortenPath(url, 40) : undefined;
		}
		case 'queue_request': {
			const req = pickString(args, 'modificationRequest', 'message');
			return req ? quote(req, 40) : undefined;
		}
		case 'deep_debug': {
			const issue = pickString(args, 'issue');
			return issue ? quote(issue, 40) : undefined;
		}
		case 'generate_files': {
			const phase = pickString(args, 'phase_name', 'phaseName');
			return phase;
		}
		default:
			return path ? pathLabel(path) : undefined;
	}
}

/**
 * Plain-English one-line summary for a tool event.
 * e.g. "Reading src/App.tsx…", "Read src/App.tsx", "Failed to read src/App.tsx"
 */
export function getToolSummary(event: ToolEvent): string {
	const verb = verbFor(event.name, event.status);
	const detail = detailFor(event.name, event.args);
	const ellipsis = event.status === 'start' ? '…' : '';
	if (!detail) return `${verb}${ellipsis}`;
	return `${verb} ${detail}${ellipsis}`;
}

/** Tools whose running label names a file even before its path is known. */
const FILE_ACTIVITY_TOOLS = new Set(['write', 'edit']);

/**
 * Running label without the trailing ellipsis, for the build progress bar.
 * e.g. "Writing src/App.tsx", "Writing file", "Deploying"
 */
export function getToolActivityLabel(name: string, args?: Record<string, unknown>): string {
	const verb = verbFor(name, 'start');
	const detail = detailFor(name, args) ?? (FILE_ACTIVITY_TOOLS.has(name) ? pathLabel(undefined) : undefined);
	return detail ? `${verb} ${detail}` : verb;
}

/** The counted noun used when collapsing multiple consecutive tools of the same name, e.g. "3 files". */
function groupNoun(name: string, count: number): string {
	switch (name) {
		case 'read':
		case 'write':
		case 'edit':
		case 'delete':
			return tn('{count} file', '{count} files', count);
		case 'list':
			return tn('{count} directory', '{count} directories', count);
		case 'find':
		case 'grep':
		case 'web_search':
			return tn('{count} search', '{count} searches', count);
		case 'bash':
		case 'exec_commands':
			return tn('{count} command', '{count} commands', count);
		case 'read_files':
			return tn('{count} file batch', '{count} file batches', count);
		case 'commit':
			return tn('{count} commit', '{count} commits', count);
		case 'ask_questions':
			return tn('{count} question set', '{count} question sets', count);
		default:
			return tn('{count} step', '{count} steps', count);
	}
}

/**
 * Summary for a collapsed group of consecutive same-name tools.
 * e.g. "Read 4 files", "Reading 2 files…", "Edited 3 files"
 */
export function getToolGroupSummary(events: ToolEvent[]): string {
	if (events.length === 0) return '';
	if (events.length === 1) return getToolSummary(events[0]);

	const name = events[0].name;
	const anyRunning = events.some((e) => e.status === 'start');
	const anyError = events.some((e) => e.status === 'error');
	const status: ToolEvent['status'] = anyRunning ? 'start' : anyError ? 'error' : 'success';
	const verb = verbFor(name, status);
	const noun = groupNoun(name, events.length);
	const ellipsis = status === 'start' ? '…' : '';
	return `${verb} ${noun}${ellipsis}`;
}

export function getGroupStatus(events: ToolEvent[]): ToolEvent['status'] {
	if (events.some((e) => e.status === 'start')) return 'start';
	if (events.some((e) => e.status === 'error')) return 'error';
	return 'success';
}
