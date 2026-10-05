import { describe, expect, it } from 'vitest';
import { BRAND } from '../../shared/brand';
import indexCss from '../index.css?raw';
import themeCss from '../styles/estori-theme.css?raw';

type Sources = Record<string, string>;

const workerSources = import.meta.glob<string>(
	['/worker/**/*.ts', '!/worker/**/*.test.ts'],
	{ query: '?raw', import: 'default', eager: true },
);

const frontendSources = import.meta.glob<string>(
	['/src/**/*.{ts,tsx}', '!/src/**/*.test.{ts,tsx}'],
	{ query: '?raw', import: 'default', eager: true },
);

/** Lines matching `pattern` in `sources`, formatted as `path:line: text`. */
function findMatches(
	sources: Sources,
	pattern: RegExp,
	allow: readonly string[] = [],
): string[] {
	return Object.entries(sources)
		.filter(([path]) => !allow.includes(path))
		.flatMap(([path, text]) =>
			text
				.split('\n')
				.flatMap((line, index) =>
					pattern.test(line) ? [`${path}:${index + 1}: ${line.trim()}`] : [],
				),
		);
}

/** Copy of `sources` with comment-only lines blanked, so rules target code and copy. */
function withoutComments(sources: Sources): Sources {
	return Object.fromEntries(
		Object.entries(sources).map(([path, text]) => [
			path,
			text
				.split('\n')
				.map((line) => (/^\s*(\/\/|\/\*|\*)/.test(line) ? '' : line))
				.join('\n'),
		]),
	);
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function source(sources: Sources, path: string): string {
	const text = sources[path];
	if (text === undefined) {
		throw new Error(`Source not found: ${path}`);
	}
	return text;
}

// The Workers test pool loads .html as a text module; `?raw` is not resolvable there.
const indexHtml = source(
	import.meta.glob<string>('/index.html', { import: 'default', eager: true }),
	'/index.html',
);

describe('brand guard: harness', () => {
	it('loads worker and frontend sources', () => {
		expect(Object.keys(workerSources).length).toBeGreaterThan(50);
		expect(Object.keys(frontendSources).length).toBeGreaterThan(50);
	});
});

describe('brand guard: worker', () => {
	it('does not commit as a VibeSDK identity', () => {
		expect(
			findMatches(workerSources, /@vibesdk\.com|vibesdk-bot|name:\s*'Vibesdk'/),
		).toEqual([]);
	});

	it('defaults git commits to the brand author', () => {
		expect(source(workerSources, '/worker/agents/git/git.ts')).toContain(
			'BRAND.gitAuthor',
		);
	});

	it('does not name VibeSDK in agent prompts', () => {
		expect(findMatches(workerSources, /VibeSDK-specific/)).toEqual([]);
	});

	it('composes the Think system prompt with the brand persona', () => {
		expect(
			source(workerSources, '/worker/agents/think/ThinkAgent.ts'),
		).toMatch(/\bcomposeSystemPrompt\(/);
	});
});

describe('brand guard: document shell', () => {
	it('activates the Estori theme on <html>', () => {
		expect(indexHtml).toMatch(/<html\b[^>]*\bdata-theme="estori"/);
	});

	it('loads the Estori theme stylesheet', () => {
		expect(indexCss).toMatch(/@import\s+['"]\.\/styles\/estori-theme\.css['"]/);
	});

	it('uses the brand title and description', () => {
		expect(indexHtml).toMatch(new RegExp(`<title>\\s*${escapeRegExp(BRAND.name)}\\s*</title>`));
		expect(indexHtml).toMatch(
			new RegExp(
				`<meta\\b(?=[^>]*\\bname="description")(?=[^>]*\\bcontent="${escapeRegExp(BRAND.description)}")`,
			),
		);
	});

	it('does not preload the retired pixel font', () => {
		expect(indexHtml).not.toContain('DepartureMono');
	});

	it('uses the Estori favicon', () => {
		expect(indexHtml).toMatch(/<link\b(?=[^>]*\brel="icon")(?=[^>]*\bhref="\/favicon\.svg")/);
	});
});

describe('brand guard: layout', () => {
	it('renders the Estori top bar above a contained sidebar', () => {
		const layout = source(frontendSources, '/src/components/layout/app-layout.tsx');
		expect(layout).toMatch(/<EstoriTopBar\b/);
		expect(layout).toMatch(/<SidebarProvider\b[^>]*\bcontained\b/);
	});

	it('drops the BUILD wordmark from the sidebar', () => {
		expect(
			findMatches(
				{ sidebar: source(frontendSources, '/src/components/layout/app-sidebar.tsx') },
				/^\s*Build\s*$/,
			),
		).toEqual([]);
	});

	it('offers Sign In from the top bar only', () => {
		expect(
			source(frontendSources, '/src/components/layout/global-header.tsx'),
		).not.toContain('Sign In');
		expect(
			source(frontendSources, '/src/components/layout/EstoriTopBar.tsx'),
		).toContain('Sign In');
	});

	it('brands the standalone header', () => {
		expect(source(frontendSources, '/src/components/header.tsx')).not.toContain(
			'CloudflareLogo',
		);
	});
});

describe('brand guard: copy', () => {
	it('titles pages with the brand name', () => {
		expect(
			findMatches(frontendSources, /- Build(?=[`'"<])|<title>Build<\/title>/),
		).toEqual([]);
	});

	it('does not show the VibeSDK name', () => {
		expect(findMatches(withoutComments(frontendSources), /VibeSDK/)).toEqual([]);
	});

	it('names the assistant after the brand', () => {
		expect(findMatches(frontendSources, /^\s*Orange\s*$/)).toEqual([]);
	});

	it('drops the uppercase BUILD headline', () => {
		expect(source(frontendSources, '/src/routes/home.tsx')).not.toContain(
			'uppercase text-brand-emphasis',
		);
	});

	it('labels passkeys with the brand name', () => {
		expect(findMatches(frontendSources, /rp: \{ name: 'vibesdk'/)).toEqual([]);
	});
});

describe('brand guard: brand color and deploy copy', () => {
	const BRAND_COLOR_FILES = [
		'/src/routes/chat/components/messages.tsx',
		'/src/routes/chat/components/thinking-indicator.tsx',
		'/src/routes/chat/components/deployment-controls.tsx',
	];

	it('uses brand tokens instead of orange in brand surfaces', () => {
		const brandSurfaces = Object.fromEntries(
			BRAND_COLOR_FILES.map((path) => [path, source(frontendSources, path)]),
		);
		expect(findMatches(brandSurfaces, /-orange-\d{2,3}/)).toEqual([]);
	});

	it('shows the preview deploy state in brand colors', () => {
		const timeline = source(frontendSources, '/src/routes/chat/components/phase-timeline.tsx');
		expect(timeline).not.toContain('color="orange"');
		const start = timeline.indexOf('else if (isPreviewDeploying) {');
		const end = timeline.indexOf('Updating your preview environment', start);
		expect(start).toBeGreaterThan(-1);
		expect(end).toBeGreaterThan(start);
		expect(timeline.slice(start, end)).not.toMatch(/-orange-\d/);
	});

	it('does not label platform deploys as Cloudflare', () => {
		expect(findMatches(frontendSources, /Deploy(ing)? to Cloudflare|Redeploying to Cloudflare|Cloudflare Workers for Platforms/)).toEqual([]);
	});

	it('has no hardcoded brand orange in the home screen', () => {
		expect(
			findMatches(
				{ home: source(frontendSources, '/src/routes/home.tsx') },
				/#ff3d00|#f6821f|rgba\(255,\s*61,\s*0|rgba\(246,\s*130,\s*31/i,
			),
		).toEqual([]);
	});

	it('recolors the run-app wallpaper icons in the theme', () => {
		expect(themeCss).toMatch(/\.run-app-icons > span\s*\{[^}]*color:\s*var\(--estori-/);
	});

	it('labels the connected Cloudflare AI Gateway balance as Cloudflare, not Estori', () => {
		expect(source(frontendSources, '/src/components/credits-banner.tsx')).not.toMatch(
			/<EstoriGlyph\b/,
		);
	});
});

describe('brand guard: Cloudflare logo usage', () => {
	/** Files where the Cloudflare logo marks a real Cloudflare integration. */
	const CLOUDFLARE_INTEGRATION_FILES = [
		'/src/components/icons/logos.tsx',
		'/src/components/shared/CloudflareLogoThemed.tsx',
		'/src/components/auth/login-modal.tsx',
		'/src/components/byok-api-keys-modal.tsx',
		'/src/components/cloudflare-account-selector.tsx',
		'/src/components/connected-accounts.tsx',
		'/src/components/credits-banner.tsx',
		'/src/components/usage-limits-card.tsx',
		'/src/components/layout/app-sidebar.tsx',
		'/src/routes/chat/chat.tsx',
		'/src/utils/usage-limit-checker.tsx',
	];

	it('renders the Cloudflare logo only for Cloudflare integrations', () => {
		expect(
			findMatches(
				frontendSources,
				/\bCloudflareLogo(Themed)?\b|provider-logos\/cloudflare\.svg/,
				CLOUDFLARE_INTEGRATION_FILES,
			),
		).toEqual([]);
	});
});

describe('brand guard: deploy availability', () => {
	it('renders Deploy only when a deploy target is available', () => {
		const chat = source(frontendSources, '/src/routes/chat/chat.tsx');
		expect(chat).toMatch(/capabilities\?\.platformDeploy/);
		expect(chat).toMatch(/behaviorType === 'think' && chatId && !appLoading && deployAvailable &&/);
	});
});
