import type { AppService } from '../../../database/services/AppService';
import type { StartedFromView } from './types';

type StartedFromRow = NonNullable<Awaited<ReturnType<AppService['getStartedFrom']>>>;

/** The "Started from" line, naming the source only while it is public and in Discover. */
export function toStartedFromView(row: StartedFromRow | null): StartedFromView | null {
    if (!row) return null;
    if (row.visibility !== 'public' || row.removedFromDiscoverAt !== null) return { available: false };
    return { available: true, appId: row.id, title: row.title, creatorName: row.creatorName ?? 'Unknown' };
}
