import { useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/auth-context';

/**
 * Calls `onChange` when the language saved on the signed-in account changes after the page opened. The account's language
 * is what the server words its answers in, and it changes only once the save has landed, so a request made then is
 * answered in the language the seller just chose; one made when the app switched, a moment earlier, could still get the old.
 */
export function useAccountLocaleChange(onChange: () => void): void {
	const { user } = useAuth();
	const saved = user?.locale ?? null;
	const seen = useRef(saved);
	const latest = useRef(onChange);
	useEffect(() => {
		latest.current = onChange;
	});
	useEffect(() => {
		if (seen.current === saved) return;
		seen.current = saved;
		latest.current();
	}, [saved]);
}
