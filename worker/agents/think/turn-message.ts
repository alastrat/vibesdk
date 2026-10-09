/**
 * Builds the user message for one Think turn: the user's text, a digest per
 * reference, and the attachments and reference screenshots as images. Digests
 * and labels are for the model only and are hidden when a chat is reloaded.
 */

import type { UIMessage } from 'ai';
import type { PendingImage } from '../../types/image-attachment';
import { agentAssetUrl } from './agent-assets';
import { formatReferenceDigest, referenceShotLabel, type ReferenceOutcome } from './references';

type TurnPart = UIMessage['parts'][number];

export interface TurnMessageInput {
	id: string;
	text: string;
	images: PendingImage[];
	references: ReferenceOutcome[];
}

export function isHiddenPart(part: unknown): boolean {
	const metadata = (part as { providerMetadata?: { estori?: { hidden?: unknown } } } | null)?.providerMetadata;
	return metadata?.estori?.hidden === true;
}

function hiddenText(text: string): TurnPart {
	return { type: 'text', text, providerMetadata: { estori: { hidden: true } } };
}

function image(r2Key: string, mediaType: string): TurnPart {
	return { type: 'file', mediaType, url: agentAssetUrl(r2Key) };
}

export function buildTurnMessage({ id, text, images, references }: TurnMessageInput): UIMessage {
	const parts: TurnPart[] = [{ type: 'text', text }];
	references.forEach((outcome, i) => parts.push(hiddenText(formatReferenceDigest(outcome, i + 1))));
	images.forEach((attachment, i) => {
		parts.push(hiddenText(`Attachment ${i + 1}`));
		parts.push(image(attachment.r2Key, attachment.mimeType));
	});
	for (const outcome of references) {
		if (!outcome.ok) continue;
		for (const shot of outcome.shots) {
			parts.push(hiddenText(referenceShotLabel(outcome.host, shot.kind)));
			parts.push(image(shot.r2Key, 'image/jpeg'));
		}
	}
	return { id, role: 'user', parts };
}
