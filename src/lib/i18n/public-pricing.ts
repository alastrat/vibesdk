import { formatUsd as usd, formatCredits as credits, limitFeatures as features, type PlanId } from '@/api-types';
import { getLocale, t, tn } from './index';

/** Public prices use the selected language's formatting and always remain US dollars. */
export const formatUsd = (cents: number): string => usd(cents, getLocale());
export const formatCredits = (amount: number): string => credits(amount, getLocale());
export const publicTranslator = () => ({ locale: getLocale(), t, tn });
export const limitFeatures = (plan: PlanId, over?: PlanId): string[] => features(plan, over, publicTranslator());
