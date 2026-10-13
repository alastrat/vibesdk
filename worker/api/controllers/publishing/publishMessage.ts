/** The confirmation shown after a publish request succeeds. */

import type { PublishRequest } from '../../../services/templates/reuse';

export function publishMessage(request: PublishRequest, outcome: { inReview: boolean; approvedLive: boolean }): string {
    if (request.visibility === 'private') return 'Your site is private';
    if (outcome.inReview && outcome.approvedLive) {
        return 'Your update is in review. The approved version stays live until an admin approves it.';
    }
    if (outcome.inReview) return 'Your site is public. Others can use it once an admin approves the price.';
    return request.priceCents > 0 ? 'Your publishing settings are saved' : 'Your site is public and others can reuse it';
}
