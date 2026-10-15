import type { CompanySize, ContactTopic } from '../../../../shared/types/contact';

export interface ContactReceivedData {
	received: true;
	/** False when no confirmation went out: email isn't set up, it failed, or the address has had enough lately. */
	confirmationSent: boolean;
}

export interface ContactAdminRequest {
	id: string;
	name: string;
	email: string;
	company: string;
	companySize: CompanySize;
	topic: ContactTopic;
	message: string | null;
	premiumCredits: number | null;
	receivedAt: string;
}

export interface ContactAdminData {
	requests: ContactAdminRequest[];
}
