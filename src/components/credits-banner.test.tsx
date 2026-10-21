/**
 * The credits banner mounted in each language: whole sentences for when the allowance resets, including a time that
 * has already passed, and amounts the way the language writes them.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import type { LimitConfig, UsageSummary } from '@/hooks/use-limits';
import { applyAccountLocale } from '@/lib/i18n';
import { mountElement, silenceTestRendererDeprecation, textOf, unmountAll } from '@/test-support/mounted';
import { CreditsBanner } from './credits-banner';

beforeAll(silenceTestRendererDeprecation);

afterEach(async () => {
	await unmountAll();
	await applyAccountLocale('en');
});

const DAY_MS = 86_400_000;

function summary(overrides: Partial<UsageSummary> & { limit?: Partial<LimitConfig>; unlimited?: boolean }): UsageSummary {
	const { limit, unlimited = false, ...rest } = overrides;
	return {
		cloudflareConnectEnabled: true,
		config: { unlimited, limit: { type: 'credits', window: 'daily', maxValue: 10, enabled: true, ...limit } },
		usage: { credits: { daily: 5 } },
		limitCheck: { withinLimits: true, exceededLimits: [], shouldUseUserKey: false, message: '' },
		hasUserToken: false,
		hasCloudflareConfigured: false,
		aiGatewayConnected: false,
		aiGatewayEnabled: false,
		aiGatewayPreferenceExplicit: false,
		...rest,
	};
}

async function bannerText(limitsData: UsageSummary): Promise<string> {
	return textOf(await mountElement(createElement(CreditsBanner, { limitsData })));
}

describe('CreditsBanner', () => {
	it('says what is left and when it resets, in English', async () => {
		const text = await bannerText(summary({ limit: { resetAt: new Date(Date.now() + 3 * DAY_MS + 60_000).toISOString() } }));
		expect(text).toContain('5 free credits remaining · resets in 3d');
	});

	it('writes the same sentence in Spanish and Portuguese, with the language\'s own short units', async () => {
		const limitsData = summary({ limit: { resetAt: new Date(Date.now() + 3 * DAY_MS + 60_000).toISOString() } });
		await applyAccountLocale('es');
		expect(await bannerText(limitsData)).toContain('5 créditos gratis restantes · se restablece en 3 d');
		await unmountAll();
		await applyAccountLocale('pt-BR');
		expect(await bannerText(limitsData)).toContain('5 créditos grátis restantes · reinicia em 3 d');
	});

	it('says "soon" as a whole sentence when the reset time has already passed', async () => {
		const limitsData = summary({ limit: { resetAt: new Date(Date.now() - 60_000).toISOString() } });
		expect(await bannerText(limitsData)).toContain('resets soon');
		await unmountAll();
		await applyAccountLocale('pt-BR');
		const portuguese = await bannerText(limitsData);
		expect(portuguese).toContain('reinicia em breve');
		expect(portuguese).not.toContain('em em breve');
		await unmountAll();
		await applyAccountLocale('es');
		expect(await bannerText(limitsData)).toContain('se restablece pronto');
	});

	it('does the same for a connected account whose own credits are low', async () => {
		const limitsData = summary({
			unlimited: true,
			limit: { resetAt: new Date(Date.now() - 60_000).toISOString() },
			hasUserToken: true,
			hasCloudflareConfigured: true,
			cloudflareCredits: { credits: 4.5, currency: 'USD' },
		});
		await applyAccountLocale('pt-BR');
		const text = await bannerText(limitsData);
		expect(text).toContain('US$');
		expect(text).toContain('os créditos grátis reiniciam em breve');
	});
});
