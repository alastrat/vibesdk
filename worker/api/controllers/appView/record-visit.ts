import type { AppService } from '../../../database/services/AppService';
import { extractRequestMetadata } from '../../../utils/authUtils';

/** Counts a view; signed-out viewers are identified by request metadata, deduplicated by AppService. */
export async function recordVisit(apps: AppService, appId: string, userId: string | undefined, request: Request): Promise<void> {
    if (userId) {
        await apps.recordAppView(appId, { userId });
        return;
    }
    const metadata = extractRequestMetadata(request);
    await apps.recordAppView(appId, { ipAddress: metadata.ipAddress, userAgent: metadata.userAgent });
}
