import type { Tool, ToolExecutionOptions } from 'ai';

/**
 * Run the given tools one at a time, in the order the model called them.
 *
 * The AI SDK starts every tool call of a step at once, so a `write` and a
 * `deploy_space` in the same step race: the deploy can commit before the write
 * lands and ship the old file. Wrapped tools must return a value or a promise,
 * not a stream.
 */
export function serializeTools<T extends Record<string, Tool>>(tools: T): T {
	let tail: Promise<unknown> = Promise.resolve();
	const serialized: Record<string, Tool> = {};
	for (const [name, original] of Object.entries(tools)) {
		const execute = original.execute;
		if (!execute) {
			serialized[name] = original;
			continue;
		}
		serialized[name] = {
			...original,
			execute: (input: unknown, options: ToolExecutionOptions) => {
				const result = tail.then(() => execute(input, options));
				tail = result.catch(() => undefined);
				return result;
			},
		};
	}
	return serialized as T;
}
