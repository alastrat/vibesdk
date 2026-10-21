import { msg, t } from '@/lib/i18n';

/** The names the server gives each kind of project, marked as messages so they translate where they are shown. */
const FEATURE_NAMES: Readonly<Record<string, string>> = {
	Application: msg('Application'),
	Presentation: msg('Presentation'),
	Workflow: msg('Workflow'),
	General: msg('General'),
};

/** The project kind's name in the active language; a name the server sends that this app doesn't know stays as sent. */
export function featureName(name: string): string {
	return Object.hasOwn(FEATURE_NAMES, name) ? t(FEATURE_NAMES[name]) : name;
}
