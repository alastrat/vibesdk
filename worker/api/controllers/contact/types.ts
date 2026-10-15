import type { CompanySize, ContactTopic } from '../../../../shared/types/contact';

export interface ContactReceivedData {
	received: true;
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
