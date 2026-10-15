/** D1 reads and writes for contact-sales requests. */

import { desc } from 'drizzle-orm';
import * as schema from '../schema';
import { BaseService } from './BaseService';
import { generateId } from '../../utils/idGenerator';
import { isCompanySize, isContactTopic, type ContactRequestInput } from '../../../shared/types/contact';

export interface ContactRequestRow extends ContactRequestInput {
	id: string;
	createdAt: Date;
}

/** How many requests the admin list shows. */
const RECENT_LIMIT = 200;

export class ContactService extends BaseService {
	async create(input: ContactRequestInput): Promise<void> {
		await this.database.insert(schema.contactRequests).values({ id: generateId(), ...input, createdAt: new Date() });
	}

	/** The latest requests, newest first; any with a topic or size the form no longer offers are left out. */
	async listRecent(limit = RECENT_LIMIT): Promise<ContactRequestRow[]> {
		const rows = await this.database
			.select({
				id: schema.contactRequests.id,
				firstName: schema.contactRequests.firstName,
				lastName: schema.contactRequests.lastName,
				email: schema.contactRequests.email,
				company: schema.contactRequests.company,
				companySize: schema.contactRequests.companySize,
				topic: schema.contactRequests.topic,
				message: schema.contactRequests.message,
				premiumCredits: schema.contactRequests.premiumCredits,
				createdAt: schema.contactRequests.createdAt,
			})
			.from(schema.contactRequests)
			.orderBy(desc(schema.contactRequests.createdAt))
			.limit(limit)
			.all();
		return rows.flatMap((row) =>
			isContactTopic(row.topic) && isCompanySize(row.companySize) ? [{ ...row, topic: row.topic, companySize: row.companySize }] : [],
		);
	}
}
