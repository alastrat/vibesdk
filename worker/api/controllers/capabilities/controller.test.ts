import { describe, expect, it } from 'vitest';
import { CapabilitiesController } from './controller';
import type { RouteContext } from '../../types/route-context';
import type { PlatformCapabilities } from '../../../agents/core/features/types';

type TestEnv = Parameters<typeof CapabilitiesController.getCapabilities>[1];
type TestCtx = Parameters<typeof CapabilitiesController.getCapabilities>[2];

const baseEnv = {
	PLATFORM_CAPABILITIES: {
		features: {
			app: { enabled: true },
			presentation: { enabled: false },
			general: { enabled: false },
		},
		version: '1.0.0',
	},
};

async function capabilitiesFor(extraEnv: Record<string, unknown>): Promise<PlatformCapabilities> {
	const env = { ...baseEnv, ...extraEnv } as unknown as TestEnv;
	const response = await CapabilitiesController.getCapabilities(
		new Request('https://app.local/api/capabilities'),
		env,
		{} as TestCtx,
		{} as RouteContext,
	);
	const body = (await response.json()) as { data: PlatformCapabilities };
	return body.data;
}

describe('CapabilitiesController.getCapabilities', () => {
	it('reports platform deploy when the dispatcher binding exists', async () => {
		const capabilities = await capabilitiesFor({ DISPATCHER: {} });
		expect(capabilities.platformDeploy).toBe(true);
	});

	it('reports no platform deploy without a dispatcher binding', async () => {
		const capabilities = await capabilitiesFor({});
		expect(capabilities.platformDeploy).toBe(false);
	});

	it('keeps user-account deploy and artifacts flags independent', async () => {
		const capabilities = await capabilitiesFor({
			ENABLE_USER_ACCOUNT_DEPLOY: 'true',
			ENABLE_ARTIFACTS: 'true',
		});
		expect(capabilities.platformDeploy).toBe(false);
		expect(capabilities.userAccountDeploy).toBe(true);
		expect(capabilities.artifacts).toBe(true);
	});
});
