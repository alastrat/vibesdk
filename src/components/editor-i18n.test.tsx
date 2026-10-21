import { afterEach, beforeAll, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { applyAccountLocale, t } from '@/lib/i18n';
import { mountElement, silenceTestRendererDeprecation, textOf, unmountAll } from '@/test-support/mounted';
import { AgentModeDisplay } from './agent-mode-display';
import { BehaviorModeToggle } from './behavior-mode-toggle';
import { publishAction } from './live-store/publish-action';
import { stripeFeesText } from './payments/payout-costs';
import general from '@/features/general';
beforeAll(silenceTestRendererDeprecation);
afterEach(async () => {
	await unmountAll();
	await applyAccountLocale('en');
});
it('updates mode controls without a reload', async () => {
	const mode = await mountElement(createElement(AgentModeDisplay, { mode: 'smart' }));
	const behavior = await mountElement(createElement(BehaviorModeToggle, { value: 'phasic', onChange: () => undefined }));
	await act(async () => applyAccountLocale('es'));
	expect(textOf(mode)).toContain('Inteligente');
	expect(textOf(behavior)).toContain('Por fases');
	await act(async () => applyAccountLocale('pt-BR'));
	expect(textOf(behavior)).toContain('Por fases');
});
it('translates publishing and view labels while preserving a seller draft name', async () => {
	await applyAccountLocale('es');
	expect(
		publishAction(
			{ status: 'offline', slug: 'my-store', hasChanges: true, draft: { id: 'draft1', name: 'My Summer Sale' } },
			'my-store',
		).label,
	).toBe("Publicar 'My Summer Sale'");
	expect(general.getViews().find((view) => view.id === 'editor')?.tooltip).toBe('Ver y editar código');
});
it('formats payout costs in the selected language and keeps USD', async () => {
	await applyAccountLocale('pt-BR');
	expect(stripeFeesText({ monthlyActiveCents: 200, payoutPercent: 0.25, payoutFixedCents: 25 }, 'pt-BR', t)).toContain('US$');
	expect(stripeFeesText({ monthlyActiveCents: 200, payoutPercent: 0.25, payoutFixedCents: 25 }, 'pt-BR', t)).toContain('por repasse');
});
