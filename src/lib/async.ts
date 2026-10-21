/** How long a load (a script, a form) gets before the page says it didn't load. */
export const LOAD_TIMEOUT_MS = 10_000;

export class LoadTimeoutError extends Error {
	constructor() {
		super('The load took too long');
		this.name = 'LoadTimeoutError';
	}
}

/** Rejects with `LoadTimeoutError` when `load` hasn't settled in `ms`; a result that arrives later is ignored. */
export function loadWithin<T>(load: Promise<T>, ms: number = LOAD_TIMEOUT_MS): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new LoadTimeoutError()), ms);
		load.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error: unknown) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}

/** Runs `task` once at a time: a call made while it runs gets the running call's result instead of starting another. */
export function singleFlight<A extends unknown[], R>(task: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
	let running: Promise<R> | null = null;
	return (...args) => {
		running ??= task(...args).finally(() => {
			running = null;
		});
		return running;
	};
}
