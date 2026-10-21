/**
 * The editor in each language: what the build status line, the tool rows, the reference cards and the notices the chat
 * adds say under `en`, `es` and `pt-BR`. Components are mounted with `react-test-renderer`, which needs no DOM.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useEffect } from 'react';
import type { WebSocket } from 'partysocket';
import { toast } from 'sonner';
import type { BuildActivity, ReferenceCard as ReferenceCardData, WebSocketMessage } from '@/api-types';
import { applyAccountLocale } from '@/lib/i18n';
import { mountElement, silenceTestRendererDeprecation, textOf, unmountAll } from '@/test-support/mounted';
import { BuildProgressBar } from '@/components/BuildProgressBar';
import { ReferenceCard } from '@/components/ReferenceCard';
import { useImageUpload, type UseImageUploadReturn } from '@/hooks/use-image-upload';
import { reasoningEffortLabel } from '@/utils/model-helpers';
import { AIMessage } from './components/messages';
import { createWebSocketMessageHandler, type HandleMessageDeps } from './utils/handle-websocket-message';
import { describeBuildActivity, type BuildStatus } from './utils/build-status';
import { skippedReferenceCard, type ChatMessage, type ToolEvent } from './utils/message-helpers';
import { featureName } from './utils/feature-name';
import { getToolActivityLabel, getToolGroupSummary, getToolSummary } from './utils/tool-display';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }));

beforeAll(silenceTestRendererDeprecation);

beforeEach(() => vi.clearAllMocks());

afterEach(async () => {
	await unmountAll();
	await applyAccountLocale('en');
});

const tool = (name: string, status: ToolEvent['status'], args?: Record<string, unknown>): ToolEvent => ({ name, status, timestamp: 1, args });

describe('the build status line', () => {
	const writing: BuildActivity = { kind: 'tool', toolName: 'write', path: 'src/pages/Catalog.tsx', lines: 340 };

	async function statusText(activity: BuildActivity): Promise<string> {
		const status: BuildStatus = { startedAt: Date.now() - 192_000, step: 4, activity };
		return textOf(await mountElement(createElement(BuildProgressBar, { status })));
	}

	it('is in English by default', async () => {
		const text = await statusText(writing);
		expect(text).toContain('Building · step 4 · 3:1');
		expect(text).toContain('Writing src/pages/Catalog.tsx');
		expect(text).toContain('340 lines');
	});

	it('follows the language, keeping the file and the host as they are', async () => {
		await applyAccountLocale('es');
		const spanish = await statusText(writing);
		expect(spanish).toContain('Creando · paso 4 · 3:1');
		expect(spanish).toContain('Escribiendo src/pages/Catalog.tsx');
		expect(spanish).toContain('340 líneas');
		expect(await statusText({ kind: 'thinking' })).toContain('Pensando…');
		expect(await statusText({ kind: 'capturing', host: 'stripe.com', index: 1, total: 2 })).toContain('Capturando stripe.com · 1 de 2');

		await unmountAll();
		await applyAccountLocale('pt-BR');
		const portuguese = await statusText(writing);
		expect(portuguese).toContain('Criando · etapa 4 · 3:1');
		expect(portuguese).toContain('Escrevendo src/pages/Catalog.tsx');
		expect(portuguese).toContain('340 linhas');
		expect(await statusText({ kind: 'capturing', host: 'stripe.com', index: 1, total: 2 })).toContain('Capturando stripe.com · 1 de 2');
	});

	it('counts one line in the singular of each language', async () => {
		const one: BuildActivity = { kind: 'tool', toolName: 'write', path: 'a.ts', lines: 1 };
		expect(describeBuildActivity(one)).toBe('Writing a.ts · 1 line');
		await applyAccountLocale('es');
		expect(describeBuildActivity(one)).toBe('Escribiendo a.ts · 1 línea');
		await applyAccountLocale('pt-BR');
		expect(describeBuildActivity(one)).toBe('Escrevendo a.ts · 1 linha');
	});
});

describe('tool labels', () => {
	it('say what a tool is doing, did or failed to do, and keep the path', async () => {
		await applyAccountLocale('es');
		expect(getToolSummary(tool('read', 'start', { path: 'src/App.tsx' }))).toBe('Leyendo src/App.tsx…');
		expect(getToolSummary(tool('read', 'success', { path: 'src/App.tsx' }))).toBe('Leyó src/App.tsx');
		expect(getToolSummary(tool('edit', 'error', { path: 'src/foo.ts' }))).toBe('No se pudo editar src/foo.ts');
		expect(getToolSummary(tool('grep', 'success', { query: 'useState', include: '*.tsx' }))).toBe('Buscó "useState" en *.tsx');
		expect(getToolSummary(tool('commit', 'success', { message: 'Add login form' }))).toBe('Hizo commit "Add login form"');
		await applyAccountLocale('pt-BR');
		expect(getToolSummary(tool('read', 'start', { path: 'src/App.tsx' }))).toBe('Lendo src/App.tsx…');
		expect(getToolSummary(tool('read', 'success', { path: 'src/App.tsx' }))).toBe('Leu src/App.tsx');
		expect(getToolSummary(tool('edit', 'error', { path: 'src/foo.ts' }))).toBe('Não foi possível editar src/foo.ts');
		expect(getToolSummary(tool('grep', 'success', { query: 'useState', include: '*.tsx' }))).toBe('Pesquisou "useState" em *.tsx');
	});

	it('count what a group holds with the right plural, and name the file before its path is known', async () => {
		const reads = [tool('read', 'success', { path: 'a.ts' }), tool('read', 'success', { path: 'b.ts' }), tool('read', 'start', { path: 'c.ts' })];
		const edits = [tool('edit', 'success'), tool('edit', 'success')];
		expect(getToolGroupSummary(reads)).toBe('Reading 3 files…');
		await applyAccountLocale('es');
		expect(getToolGroupSummary(reads)).toBe('Leyendo 3 archivos…');
		expect(getToolGroupSummary(edits)).toBe('Editó 2 archivos');
		expect(getToolActivityLabel('write')).toBe('Escribiendo archivo');
		expect(getToolActivityLabel('deploy_space')).toBe('Desplegando');
		await applyAccountLocale('pt-BR');
		expect(getToolGroupSummary(edits)).toBe('Editou 2 arquivos');
		expect(getToolActivityLabel('write')).toBe('Escrevendo arquivo');
	});

	it('show a tool the app has no words for by its own name', async () => {
		await applyAccountLocale('es');
		expect(getToolSummary(tool('custom_tool', 'start'))).toBe('Ejecutando custom tool…');
		expect(getToolSummary(tool('custom_tool', 'success'))).toBe('Custom tool');
	});

	it('render as rows in the message, in the language of the moment', async () => {
		const parts: ChatMessage['parts'] = [
			{ type: 'tool', event: tool('read', 'success', { path: 'src/App.tsx' }) },
			{ type: 'tool', event: tool('edit', 'success', { path: 'a.ts' }) },
			{ type: 'tool', event: tool('edit', 'success', { path: 'b.ts' }) },
			{ type: 'tool', event: tool('deploy_space', 'start') },
		];
		await applyAccountLocale('es');
		const text = textOf(await mountElement(createElement(AIMessage, { parts })));
		expect(text).toContain('Leyó src/App.tsx');
		expect(text).toContain('Editó 2 archivos');
		expect(text).toContain('Desplegando…');
	});
});

describe('a reference card that could not be captured', () => {
	const reference: ReferenceCardData = skippedReferenceCard('https://www.example.com/pricing');

	it('says why in the language, keeping the host', async () => {
		const english = textOf(await mountElement(createElement(ReferenceCard, { reference })));
		expect(english).toContain("Couldn't capture");
		expect(english).toContain('example.com');
		expect(english).toContain('only the first 3 links are captured; this one stays as text');
		await unmountAll();
		await applyAccountLocale('es');
		const spanish = textOf(await mountElement(createElement(ReferenceCard, { reference })));
		expect(spanish).toContain('No se pudo capturar');
		expect(spanish).toContain('example.com');
		expect(spanish).toContain('solo se capturan los 3 primeros enlaces; este queda como texto');
	});
});

describe('what the chat adds around the AI', () => {
	const websocket = {} as WebSocket;

	function depsWith(state: Partial<HandleMessageDeps>): HandleMessageDeps {
		const spies = new Map<string | symbol, ReturnType<typeof vi.fn>>();
		return new Proxy(state, {
			get(target, key) {
				if (key in target) return target[key as keyof HandleMessageDeps];
				if (!spies.has(key)) spies.set(key, vi.fn());
				return spies.get(key);
			},
		}) as HandleMessageDeps;
	}

	const sent = (deps: HandleMessageDeps): string[] => vi.mocked(deps.sendMessage).mock.calls.map(([message]) => String((message as { content?: unknown }).content));

	it('words a code review by what it found, with the plural of each count', async () => {
		const review = {
			type: 'code_reviewed',
			review: { issuesFound: true, filesToFix: [{ issues: [1, 2] }, { issues: [3] }] },
		} as unknown as WebSocketMessage;
		const english = depsWith({ behaviorType: 'phasic' });
		createWebSocketMessageHandler(english)(websocket, review);
		expect(sent(english)).toEqual(['Code review complete - 3 issues found across 2 files']);

		await applyAccountLocale('es');
		const spanish = depsWith({ behaviorType: 'phasic' });
		createWebSocketMessageHandler(spanish)(websocket, review);
		expect(sent(spanish)).toEqual(['Revisión de código completa: 3 problemas en 2 archivos']);

		await applyAccountLocale('pt-BR');
		const portuguese = depsWith({ behaviorType: 'phasic' });
		createWebSocketMessageHandler(portuguese)(websocket, review);
		expect(sent(portuguese)).toEqual(['Revisão de código concluída: 3 problemas em 2 arquivos']);
	});

	it('toasts a stopped generation and a failed deployment in the language', async () => {
		await applyAccountLocale('es');
		const deps = depsWith({ behaviorType: 'phasic' });
		const handle = createWebSocketMessageHandler(deps);
		handle(websocket, { type: 'generation_stopped', message: '' } as unknown as WebSocketMessage);
		expect(toast.info).toHaveBeenCalledWith('Generación detenida', { description: 'La generación de código se detuvo' });
		handle(websocket, { type: 'cloudflare_deployment_error', error: 'Quota exceeded' } as unknown as WebSocketMessage);
		expect(toast.error).toHaveBeenCalledWith('Error: Quota exceeded');
		expect(sent(deps)).toContain('Falló el despliegue: Quota exceeded\n\nPuedes intentar desplegar de nuevo.');
	});

	it('leaves the text the server sends as it is', async () => {
		await applyAccountLocale('es');
		const deps = depsWith({ behaviorType: 'phasic' });
		createWebSocketMessageHandler(deps)(websocket, { type: 'phase_generating', message: 'Generating the next phase' } as unknown as WebSocketMessage);
		expect(sent(deps)).toEqual(['Generating the next phase']);
	});
});

describe('adding images', () => {
	let upload: UseImageUploadReturn | null = null;
	const onError = vi.fn();

	function Harness() {
		const hook = useImageUpload({ onError });
		useEffect(() => {
			upload = hook;
		});
		return null;
	}

	beforeEach(() => {
		upload = null;
	});

	async function addGif(): Promise<void> {
		await mountElement(createElement(Harness));
		await act(async () => {
			await upload?.addImages([new File(['x'], 'cat.gif', { type: 'image/gif' })]);
		});
	}

	it('shows one toast for a refused file and passes the same words to the caller', async () => {
		await addGif();
		expect(toast.error).toHaveBeenCalledTimes(1);
		expect(toast.error).toHaveBeenCalledWith('Unsupported image type: image/gif. Only PNG, JPEG, WEBP are supported.');
		expect(onError).toHaveBeenCalledTimes(1);
		expect(onError).toHaveBeenCalledWith('Unsupported image type: image/gif. Only PNG, JPEG, WEBP are supported.');
	});

	it('words the refusal in the language', async () => {
		await applyAccountLocale('es');
		await addGif();
		expect(toast.error).toHaveBeenCalledTimes(1);
		expect(toast.error).toHaveBeenCalledWith('Tipo de imagen no compatible: image/gif. Solo se admiten PNG, JPEG, WEBP.');
		expect(onError).toHaveBeenCalledTimes(1);
	});
});

describe('words that come from data', () => {
	it('names a kind of project in the language, and leaves one it does not know as sent', async () => {
		await applyAccountLocale('es');
		expect(featureName('Application')).toBe('Aplicación');
		expect(featureName('Presentation')).toBe('Presentación');
		expect(featureName('Something else')).toBe('Something else');
		expect(featureName('constructor')).toBe('constructor');
	});

	it('names how hard a model thinks, and leaves an effort it does not know as sent', async () => {
		await applyAccountLocale('pt-BR');
		expect(reasoningEffortLabel('high')).toBe('Alto');
		expect(reasoningEffortLabel('ultra')).toBe('Ultra');
	});
});
