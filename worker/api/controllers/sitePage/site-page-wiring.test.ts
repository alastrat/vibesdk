import { describe, expect, it } from 'vitest';
import { AI_MODEL_CONFIG, AIModels, isValidAIModel } from '../../../agents/inferutils/config.types';
import { THINK_MODELS } from '../../../agents/think/model-config';

const sources = import.meta.glob<string>(
	[
		'/worker/api/routes/sitePageRoutes.ts',
		'/worker/api/routes/index.ts',
		'/worker/api/controllers/sitePage/controller.ts',
		'/worker/api/controllers/sitePage/draftController.ts',
		'/worker/api/controllers/appView/controller.ts',
		'/worker/agents/core/behaviors/think.ts',
		'/worker/agents/core/behaviors/base.ts',
		'/worker/agents/core/codingAgent.ts',
	],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('product page routes', () => {
	it('serves the page and its approved screenshots to anyone', () => {
		const routes = source('/worker/api/routes/sitePageRoutes.ts').split('\n');
		expect(routes.find((line) => line.includes("'/api/discover/:appId'"))).toContain('setAuthLevel(AuthConfig.public)');
		expect(routes.find((line) => line.includes("'/api/discover/:appId/screenshots/:kind'"))).toContain(
			'setAuthLevel(AuthConfig.public)',
		);
		expect(source('/worker/api/routes/index.ts')).toContain('setupSitePageRoutes(app)');
	});

	it('rate limits the page, records a visit and never returns source code', () => {
		const controller = source('/worker/api/controllers/sitePage/controller.ts');
		expect(controller).toContain('enforcePublicAppsRateLimit(');
		expect(controller).toContain('recordVisit(');
		expect(controller).not.toContain('getSummary(');
		expect(controller).not.toContain('agentSummary');
		expect(source('/worker/api/controllers/appView/controller.ts')).toContain('recordVisit(');
	});

	it('signs the creator thumbnails so the images load', () => {
		expect(source('/worker/api/controllers/sitePage/controller.ts')).toContain('enrichUrls(');
	});

	it('previews through the anonymous public preview and never mints an owner-bearing source', () => {
		const controller = source('/worker/api/controllers/sitePage/controller.ts');
		expect(controller).toContain('getPublicPreviewURL(');
		expect(controller).toContain('getDeployedCommit(');
		expect(controller).not.toContain('getTemplateSource(');
	});
});

describe('public preview subject', () => {
	it('signs the public preview with the anonymous subject, and every other preview with the owner', () => {
		const think = source('/worker/agents/core/behaviors/think.ts');
		expect(think).toContain('getBrowserPreviewURL(previewVersionOverride?: number, subject?: string)');
		expect(think).toContain('userId: subject ?? this.state.metadata.userId');
		expect(think).toContain('getBrowserPreviewURL(undefined, PUBLIC_PREVIEW_SUBJECT)');
	});

	it('exposes the public preview from the coding agent to its behavior, and the base behavior has none', () => {
		expect(source('/worker/agents/core/codingAgent.ts')).toContain('this.behavior.getPublicPreviewURL()');
		expect(source('/worker/agents/core/behaviors/base.ts')).toMatch(/getPublicPreviewURL\(\): Promise<string \| null> \{\s*return null;/);
	});
});

describe('drafting page text', () => {
	it('is owner-only, rate limited before the model call, and uses the lite model', () => {
		const routes = source('/worker/api/routes/sitePageRoutes.ts').split('\n');
		expect(routes.find((line) => line.includes("'/api/apps/:id/page-copy/draft'"))).toContain('setAuthLevel(AuthConfig.ownerOnly)');
		const draft = source('/worker/api/controllers/sitePage/draftController.ts');
		expect(draft.indexOf('enforcePageCopyDraftRateLimit(')).toBeGreaterThan(-1);
		expect(draft.indexOf('enforcePageCopyDraftRateLimit(')).toBeLessThan(draft.indexOf('draftPageCopy('));
		expect(draft).toContain("agentActionName: 'templateSelection'");
		expect(draft).toContain('PAGE_DRAFT_FAILED_MESSAGE');
	});
});

describe('the model that drafts page text', () => {
	const draft = source('/worker/api/controllers/sitePage/draftController.ts');
	const modelKey = /const PAGE_DRAFT_MODEL_ID = AIModels\.([A-Z0-9_]+);/.exec(draft)?.[1];
	const modelId = modelKey && modelKey in AIModels ? AIModels[modelKey as keyof typeof AIModels] : undefined;

	it('is the cheapest current Think model, named from the AIModels catalog and passed explicitly with a single attempt', () => {
		expect(modelKey).toBe('GEMINI_3_6_FLASH');
		expect(modelId).toBe('google-ai-studio/gemini-3.6-flash');
		expect(draft).not.toContain("'google-ai-studio/gemini-3.6-flash'");
		const cheapest = [...THINK_MODELS].sort((a, b) => a.config.creditCost - b.config.creditCost)[0];
		expect(cheapest.id).toBe(modelId);
		expect(draft).toContain('modelName: PAGE_DRAFT_MODEL_ID');
		// One attempt: later attempts would swap in the retired fallback models.
		expect(draft).toContain('retryLimit: 1');
	});

	it('is known to the inference catalog, which inference needs to reach the gateway', () => {
		expect(modelId && isValidAIModel(modelId)).toBe(true);
		const thinkModel = THINK_MODELS.find((model) => model.id === modelId);
		expect(modelId && isValidAIModel(modelId) ? AI_MODEL_CONFIG[modelId] : undefined).toEqual(thinkModel?.config);
	});
});
