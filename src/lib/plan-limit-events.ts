/** Plan-limit refusals from anywhere in the app, handed to the one Upgrade dialog. */

import type { PlanLimitRefusal } from '@/api-types';

type PlanLimitListener = (refusal: PlanLimitRefusal) => void;

const listeners = new Set<PlanLimitListener>();

export function announcePlanLimit(refusal: PlanLimitRefusal): void {
	for (const listener of listeners) listener(refusal);
}

/** Listens for refusals; answers the function that stops listening. */
export function onPlanLimit(listener: PlanLimitListener): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}
