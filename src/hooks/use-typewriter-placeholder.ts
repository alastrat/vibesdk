import { useState, useEffect } from 'react';

function prefersReducedMotion(): boolean {
	return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Typewriter effect that cycles through phrases, typing and erasing them.
 * Returns the current text to display as a placeholder; with reduced motion,
 * the first phrase in full.
 * Callers should memoize the phrases array to avoid resetting the animation.
 */
export function useTypewriterPlaceholder(
	phrases: string[],
	enabled: boolean,
): string {
	const [reduceMotion] = useState(prefersReducedMotion);
	const [phraseIndex, setPhraseIndex] = useState(0);
	const [text, setText] = useState('');
	const [isTyping, setIsTyping] = useState(true);

	useEffect(() => {
		if (!enabled || reduceMotion || phrases.length === 0) return;

		const currentPhrase = phrases[phraseIndex];

		if (isTyping) {
			if (text.length < currentPhrase.length) {
				const timeout = setTimeout(() => {
					setText(currentPhrase.slice(0, text.length + 1));
				}, 100);
				return () => clearTimeout(timeout);
			} else {
				const timeout = setTimeout(() => {
					setIsTyping(false);
				}, 2000);
				return () => clearTimeout(timeout);
			}
		} else {
			if (text.length > 0) {
				const timeout = setTimeout(() => {
					setText(text.slice(0, -1));
				}, 50);
				return () => clearTimeout(timeout);
			} else {
				setPhraseIndex((prev) => (prev + 1) % phrases.length);
				setIsTyping(true);
			}
		}
	}, [text, phraseIndex, isTyping, phrases, enabled, reduceMotion]);

	if (!enabled) return '';
	if (reduceMotion) return phrases[0] ?? '';
	return text;
}
