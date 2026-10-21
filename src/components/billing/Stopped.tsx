import { Banner, Button, LayerCard } from '@cloudflare/kumo';
import { WarningCircleIcon } from '@phosphor-icons/react';
import { t } from '@/lib/i18n';
import { BackToBilling } from './BackToBilling';

/**
 * Takes the form's place when a payment page can't go on: a refusal, a timeout, a form that didn't load. The message is
 * the server's words or one of the page's own, and is translated here, where it is shown.
 */
export function Stopped({ message, action }: { message: string; action: { label: string; onClick: () => void } | null }) {
	return (
		<LayerCard>
			<LayerCard.Primary>
				<div className="grid gap-4">
					<Banner variant="alert" icon={<WarningCircleIcon />} description={t(message)} />
					<div className="flex flex-wrap items-center gap-2">
						{action && (
							<Button variant="primary" onClick={action.onClick}>
								{action.label}
							</Button>
						)}
						<BackToBilling />
					</div>
				</div>
			</LayerCard.Primary>
		</LayerCard>
	);
}
