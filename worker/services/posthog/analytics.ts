/** Estori's typed server analytics: the catalog's names and properties only, over the capture client. */

import { SERVER_EVENTS, type PersonProperties, type ServerEventName, type ServerEventProperties } from '../../../shared/types/analytics-events';
import { AnalyticsPersonService } from '../../database/services/AnalyticsPersonService';
import { PostHogClient, type CaptureInput, type EventValue } from './client';
import { posthogConfig } from './config';
import { keepAlive } from './request-scope';

export interface PersonUpdate {
	set?: Partial<PersonProperties>;
	setOnce?: Partial<PersonProperties>;
}

export interface ServerAnalytics {
	capture<N extends ServerEventName>(name: N, distinctId: string, properties: ServerEventProperties<N>, person?: PersonUpdate): void;
}

export function analyticsOver(client: Pick<PostHogClient, 'capture'>): ServerAnalytics {
	return {
		capture(name, distinctId, properties, person) {
			const fields: Record<string, EventValue> = { ...properties };
			const props: Record<string, EventValue> = { ...fields };
			if (person?.set) props.$set = person.set;
			if (person?.setOnce) props.$set_once = person.setOnce;
			const definition = SERVER_EVENTS[name];
			const input: CaptureInput = { event: name, distinctId, properties: props, personless: definition.subject === 'system' };
			if (definition.costFields) input.anonymousCost = Object.fromEntries(definition.costFields.map((field) => [field, fields[field]]));
			client.capture(input);
		},
	};
}

/** A client for this request or Durable Object call; events captured in one tick go out together. */
export function serverAnalytics(env: Env): ServerAnalytics {
	return analyticsOver(
		new PostHogClient({
			config: posthogConfig(env),
			fetcher: (input, init) => fetch(input, init),
			optedOut: (userIds) => new AnalyticsPersonService(env).optedOutAmong(userIds),
			keepAlive,
			now: () => new Date(),
		}),
	);
}
