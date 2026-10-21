import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Button, buttonVariants, cn } from '@cloudflare/kumo';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { PlanLimitRefusal } from '@/api-types';
import { usePlanCheckout } from '@/hooks/use-billing';
import { useI18n } from '@/lib/i18n';
import { onPlanLimit } from '@/lib/plan-limit-events';
import { upgradeActionFor, upgradeTitleFor } from './upgrade-action';

/** One plan-limit refusal: its title and message, and the next step it offers. */
export function UpgradeDialog({ refusal, onClose }: { refusal: PlanLimitRefusal; onClose: () => void }) {
	const { t } = useI18n();
	const checkout = usePlanCheckout();
	const action = upgradeActionFor(refusal);

	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>{upgradeTitleFor(refusal)}</DialogTitle>
					<DialogDescription>{t(refusal.message)}</DialogDescription>
				</DialogHeader>
				<div className="flex justify-end gap-2">
					<Button variant="secondary" onClick={onClose}>
						{action.kind === 'none' ? t('Close') : t('Not now')}
					</Button>
					{action.kind === 'checkout' && (
						<Button
							variant="primary"
							onClick={() => {
								checkout.start(action.plan);
								onClose();
							}}
						>
							{action.label}
						</Button>
					)}
					{action.kind === 'link' && (
						<Link to={action.to} onClick={onClose} className={cn(buttonVariants({ variant: 'primary' }))}>
							{action.label}
						</Link>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}

/** Shows the Upgrade dialog for the latest plan-limit refusal announced anywhere in the app. */
export function UpgradeDialogHost() {
	// Numbered, so a new refusal starts a fresh dialog rather than reusing the last one.
	const [shown, setShown] = useState<{ id: number; refusal: PlanLimitRefusal } | null>(null);

	useEffect(() => {
		let announced = 0;
		return onPlanLimit((refusal) => {
			announced += 1;
			setShown({ id: announced, refusal });
		});
	}, []);

	if (!shown) return null;
	return <UpgradeDialog key={shown.id} refusal={shown.refusal} onClose={() => setShown(null)} />;
}
