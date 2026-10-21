import type { Locale } from '../../../shared/i18n/locales';
import { serverT } from './server-t';

/** Only platform status copy is translated. Conversation content, files and tool results remain as written. */
export function localizeAgentStatus<T>(type: string, data: T, locale: Locale): T {
	if (
		!/^(?:phase_|generation_|deployment_|cloudflare_deployment_|github_export_|error$|rate_limit_error$|conversation_cleared$)/.test(
			type,
		) ||
		!data ||
		typeof data !== 'object'
	)
		return data;
	const translated: Record<string, string> = {};
	for (const [field, value] of Object.entries(data)) {
		if ((field === 'message' || field === 'error') && typeof value === 'string') translated[field] = serverT(locale).t(value);
	}
	return { ...data, ...translated };
}
