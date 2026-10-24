function canFocus(element: Element | null): element is HTMLElement {
	return (
		element !== null &&
		'focus' in element &&
		typeof element.focus === 'function'
	);
}

/** A persistent trigger survives the menu item that opened this dialog. */
export function accountMenuTrigger(document: Document): HTMLElement | null {
	return (
		[
			...document.querySelectorAll<HTMLElement>(
				'[data-account-menu-trigger]',
			),
		].find(
			(element) =>
				element.isConnected && element.getClientRects().length > 0,
		) ?? null
	);
}

export function settingsOpener(document: Document): HTMLElement | null {
	const active = document.activeElement;
	const menu = active?.closest('[role="menu"]');
	if (menu) {
		for (const id of (menu.getAttribute('aria-labelledby') ?? '').split(
			/\s+/,
		)) {
			const trigger = document.getElementById(id);
			if (
				canFocus(trigger) &&
				trigger.getAttribute('aria-haspopup') === 'menu'
			)
				return trigger;
		}
		const trigger = [
			...document.querySelectorAll<HTMLElement>('[aria-haspopup="menu"]'),
		].find(
			(element) =>
				menu.id &&
				element
					.getAttribute('aria-controls')
					?.split(/\s+/)
					.includes(menu.id),
		);
		return trigger ?? accountMenuTrigger(document);
	}
	if (
		canFocus(active) &&
		active.matches(
			'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
		)
	)
		return active;
	return accountMenuTrigger(document);
}

export function returnSettingsFocus(
	opener: HTMLElement | null,
	document: Document,
): void {
	const target = opener?.isConnected ? opener : accountMenuTrigger(document);
	target?.focus({ preventScroll: true });
}
