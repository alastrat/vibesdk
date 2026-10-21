/** Plan refusals in the current seller request or agent turn's language. */
import {
	assertWithinLimit as sharedAssertWithinLimit,
	type PlanAccount,
	type PlanLimitKey,
	type PlanLimitRefusal,
} from '../../../shared/types/plans';
import { currentLocale } from './request-locale';
import { serverT } from './server-t';

export function assertWithinLimit(account: PlanAccount, key: PlanLimitKey, current = 0): PlanLimitRefusal | null {
	return sharedAssertWithinLimit(account, key, current, serverT(currentLocale()));
}
