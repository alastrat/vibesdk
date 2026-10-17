import { EARLY_ACCESS_CAPABILITIES, isEarlyAccessCapability, type EarlyAccessCapability } from '../../../../shared/types/early-access';
import type { EarlyAccessRequestRow } from '../../../database/services/EarlyAccessService';
import type { EarlyAccessAdminData } from './types';

export type ParsedEarlyAccessRequest = { ok: true; capability: EarlyAccessCapability } | { ok: false; error: string };

/** Accepts only the programs that take requests; built-in capabilities have no waitlist. */
export function parseEarlyAccessRequest(body: unknown): ParsedEarlyAccessRequest {
    const capability = typeof body === 'object' && body !== null && 'capability' in body ? body.capability : undefined;
    return isEarlyAccessCapability(capability) ? { ok: true, capability } : { ok: false, error: 'Unknown early access program' };
}

export function toEarlyAccessAdminData(rows: readonly EarlyAccessRequestRow[]): EarlyAccessAdminData {
    const counts = Object.fromEntries(EARLY_ACCESS_CAPABILITIES.map((id) => [id, 0])) as Record<EarlyAccessCapability, number>;
    for (const row of rows) counts[row.capability] += 1;
    return {
        counts,
        requests: rows.map((row) => ({
            capability: row.capability,
            email: row.email,
            displayName: row.displayName,
            requestedAt: row.createdAt.toISOString(),
        })),
    };
}
