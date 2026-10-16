/** The seller's agreement to the selling terms, required before their stores take payments. */

import { eq } from 'drizzle-orm';
import * as schema from '../schema';
import { BaseService } from './BaseService';
import { SELLER_TERMS_VERSION, isCurrentSellerTermsVersion } from '../../../shared/types/seller-setup';

export class SellerTermsService extends BaseService {
	/** Records the agreement; false, with nothing written, when the version isn't the current one. */
	async accept(userId: string, version: unknown, now: Date): Promise<boolean> {
		if (!isCurrentSellerTermsVersion(version)) return false;
		await this.database
			.update(schema.users)
			.set({ sellerTermsVersion: SELLER_TERMS_VERSION, sellerTermsAcceptedAt: now, updatedAt: now })
			.where(eq(schema.users.id, userId))
			.run();
		return true;
	}

	async hasAccepted(userId: string): Promise<boolean> {
		const row = await this.database
			.select({ version: schema.users.sellerTermsVersion })
			.from(schema.users)
			.where(eq(schema.users.id, userId))
			.get();
		return isCurrentSellerTermsVersion(row?.version);
	}
}
