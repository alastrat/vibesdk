import type { ReactNode } from 'react';
import { LayerCard } from '@cloudflare/kumo';

/** The heading strip of a billing card: an icon and a title in the app's mono face. */
export function SectionTitle({ icon, children }: { icon: ReactNode; children: ReactNode }) {
	return (
		<LayerCard.Secondary className="font-funky-mono tracking-tighter">
			<div className="flex items-center gap-2">
				<span className="flex items-center">{icon}</span>
				<span>{children}</span>
			</div>
		</LayerCard.Secondary>
	);
}
