/** API types for early-access requests. */

import type { EarlyAccessCapability } from '../../../../shared/types/early-access';

export interface MyEarlyAccessData {
    capabilities: EarlyAccessCapability[];
}

export interface EarlyAccessAdminRequest {
    capability: EarlyAccessCapability;
    email: string;
    displayName: string;
    /** ISO timestamp. */
    requestedAt: string;
}

export interface EarlyAccessAdminData {
    counts: Record<EarlyAccessCapability, number>;
    requests: EarlyAccessAdminRequest[];
}
