import { createContext, useContext } from 'react';

export type AccountSettingsSection =
	| 'profile'
	| 'appearance'
	| 'connections'
	| 'security'
	| 'billing'
	| 'privacy';
export interface AccountSettingsContextValue {
	openSettings: (section?: string) => void;
	closeSettings: () => void;
	isOpen: boolean;
}
export const AccountSettingsContext =
	createContext<AccountSettingsContextValue | null>(null);

export function useAccountSettings(): AccountSettingsContextValue {
	const context = useContext(AccountSettingsContext);
	if (!context)
		throw new Error(
			'useAccountSettings must be used within AccountSettingsProvider',
		);
	return context;
}
