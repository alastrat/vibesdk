/** Drafting page text with a model, checked against the shared limits, with one corrective retry. */

import z from 'zod';
import { createUserMessage, type Message } from '../../agents/inferutils/common';
import { validatePageCopy, type SitePageCopy } from '../../../shared/types/site-page';
import { buildDraftMessages, type DraftRequest } from './draft-input';

export const PageCopyDraftSchema = z.object({
	tagline: z.string(),
	about: z.array(z.string()),
	features: z.array(z.string()),
	includes: z.array(z.object({ name: z.string(), detail: z.string() })),
	madeFor: z.array(z.string()),
});

/** Sends messages to the model and returns its structured answer, or null when there is none. */
export type PageCopyCompleter = (messages: Message[]) => Promise<unknown>;

export class PageCopyDraftError extends Error {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = 'PageCopyDraftError';
	}
}

async function ask(complete: PageCopyCompleter, messages: Message[]): Promise<unknown> {
	try {
		return await complete(messages);
	} catch (error) {
		throw new PageCopyDraftError('The drafting call failed', { cause: error });
	}
}

export async function draftPageCopy(complete: PageCopyCompleter, request: DraftRequest): Promise<SitePageCopy> {
	const messages = buildDraftMessages(request);
	const first = validatePageCopy(await ask(complete, messages));
	if (first.ok) return first.value;
	const retry = createUserMessage(`Your answer broke a rule: ${first.error}. Return the whole page again, following every limit.`);
	const second = validatePageCopy(await ask(complete, [...messages, retry]));
	if (second.ok) return second.value;
	throw new PageCopyDraftError(`The draft broke a rule twice: ${second.error}`);
}
