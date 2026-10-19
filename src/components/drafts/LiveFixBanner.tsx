import { Button } from '@cloudflare/kumo';
import { useDrafts } from '@/hooks/use-drafts';
import { bringInRequest, showsLiveFixBanner } from './draft-view';

interface LiveFixBannerProps {
	appId: string;
	/** Changes whenever the preview reloads, so the banner follows deploys and switches. */
	refreshKey: string | undefined;
	/** Sends a chat request to the AI, as if the seller typed it. */
	onSendMessage: (message: string) => void;
}

/** On Main, after a fix went live from another draft: offers to bring it in. */
export function LiveFixBanner({ appId, refreshKey, onSendMessage }: LiveFixBannerProps) {
	const drafts = useDrafts(appId, true, refreshKey);
	if (!drafts.data || !showsLiveFixBanner(drafts.data)) return null;
	return (
		<div className="flex items-center justify-between gap-3 border-b border-kumo-line bg-kumo-elevated px-3 py-2 text-sm">
			<span>The live store has a fix Main doesn't have.</span>
			<Button variant="secondary" size="sm" onClick={() => onSendMessage(bringInRequest('Main'))}>
				Bring it in
			</Button>
		</div>
	);
}
