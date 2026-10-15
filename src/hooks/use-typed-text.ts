import { useEffect, useState } from 'react';

/**
 * Types `text` one character at a time while `active`, starting over each time it turns active again.
 * Callers show the whole text when the visitor asked for reduced motion; their story never turns this on.
 */
export function useTypedText(text: string, active: boolean, msPerChar = 55): string {
	const [typed, setTyped] = useState(0);

	useEffect(() => {
		if (!active) return;
		let count = 0;
		const timer = setInterval(() => {
			count = Math.min(text.length, count + 1);
			setTyped(count);
		}, msPerChar);
		return () => {
			clearInterval(timer);
			setTyped(0);
		};
	}, [text, active, msPerChar]);

	return text.slice(0, typed);
}
