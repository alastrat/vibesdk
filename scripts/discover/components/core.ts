import type { CatalogArtifact } from '../artifact-types';

export interface Scene {
 title: string;
 categorySlug: string;
 premium?: boolean;
 summary: string;
 description: string;
 tags: string[];
 features: string[];
 palette: [string, string, string];
 art: string;
 css: string;
 controls: string;
 script: string;
 initialStatus: string;
}

export const svg = (body: string) => `<svg viewBox="0 0 600 400" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Original motion illustration">${body}</svg>`;
export const label = (x: number, y: number, text: string, size = 14, fill = 'currentColor') => `<text x="${x}" y="${y}" font-family="Arial,sans-serif" font-size="${size}" fill="${fill}">${text}</text>`;
export const buttons = (items: string[], attribute: string) => items.map((item, index) => `<button type="button" data-${attribute}="${index}" aria-pressed="${index === 0}">${item}</button>`).join('');
const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

const baseCss = `
:host{display:block;color:var(--ink);font-family:Arial,Helvetica,sans-serif;background:var(--paper);border-radius:24px;overflow:hidden;isolation:isolate}
*{box-sizing:border-box} .component{padding:clamp(18px,4vw,40px);max-width:1000px;margin:auto}
header{display:flex;align-items:center;justify-content:space-between;gap:12px} .eyebrow{font-size:10px;letter-spacing:.2em;text-transform:uppercase;font-weight:700;opacity:.65}
h1{font-size:clamp(24px,5vw,42px);font-weight:500;letter-spacing:-.045em;margin:9px 0 0;line-height:1.1}.art{margin:8px auto 10px;max-width:720px;position:relative}.art>svg{display:block;width:100%;height:auto;overflow:visible}.controls{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:9px;min-height:42px}
button{font:inherit;font-size:12px;color:var(--ink);background:transparent;border:1px solid currentColor;border-radius:30px;min-height:42px;padding:10px 16px;cursor:pointer;transition:background .2s,color .2s,transform .2s}button:hover{transform:translateY(-2px)}button[aria-pressed=true]{background:var(--ink);color:var(--paper)}button:focus-visible,input:focus-visible{outline:3px solid var(--accent);outline-offset:4px}button[data-pause]{font-size:11px;min-width:100px;flex-shrink:0}label{font-size:12px;display:flex;align-items:center;gap:14px}input[type=range]{width:clamp(140px,35vw,300px);accent-color:var(--ink);min-height:42px;cursor:pointer}.status{text-align:center;font-size:12px;min-height:18px;opacity:.72;letter-spacing:.025em;margin:16px 0 0}
:host([data-motion-paused]) *,:host([data-motion-paused]) *::before,:host([data-motion-paused]) *::after{animation-play-state:paused!important;transition:none!important}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
@media(max-width:420px){.component{padding:18px}.eyebrow{font-size:9px}button{font-size:11px;padding:9px 12px}header{align-items:flex-start}button[data-pause]{min-width:90px}.art{margin-top:18px}}
`;

export function buildScene(scene: Scene): CatalogArtifact {
 const slug = scene.title.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replace(/-$/, '');
 const [paper, ink, accent] = scene.palette;
 const css = `:host{--paper:${paper};--ink:${ink};--accent:${accent}}${baseCss}${scene.css}`;
 const markup = `<style>${css}</style><section class="component" aria-label="${escape(scene.title)}"><header><div><span class="eyebrow">Estori motion studies / ${escape(scene.tags[0])}</span><h1>${escape(scene.title)}</h1></div><button type="button" data-pause="" aria-pressed="false" aria-label="Pause animation">Pause motion</button></header><div class="art">${scene.art}</div><div class="controls" aria-label="Scene controls">${scene.controls}</div><p class="status" role="status" aria-live="polite">${escape(scene.initialStatus)}</p></section>`;
 const implementation = `function mountComponent(host) {
 if (!(host instanceof HTMLElement)) throw new TypeError('A host HTMLElement is required');
 const root = host.shadowRoot || host.attachShadow({mode:'open'});
 root.innerHTML = ${JSON.stringify(markup)};
 const cleanups = [];
 const q = selector => root.querySelector(selector);
 const qa = selector => Array.from(root.querySelectorAll(selector));
 const on = (target, event, handler) => { target.addEventListener(event, handler); cleanups.push(() => target.removeEventListener(event, handler)); };
 const bind = (selector, event, handler) => qa(selector).forEach(element => on(element, event, eventObject => handler(element,eventObject)));
 const status = text => { q('.status').textContent = text; };
 const select = (selector, element) => qa(selector).forEach(item => item.setAttribute('aria-pressed', String(item === element)));
 const reduced = matchMedia('(prefers-reduced-motion: reduce)');
 let userPaused = false, parentPaused = false, offscreen = false;
 const syncMotion = () => {
  const paused = userPaused || parentPaused || offscreen || document.hidden || reduced.matches;
  host.toggleAttribute('data-motion-paused', paused);
  q('[data-pause]').setAttribute('aria-pressed', String(userPaused));
  q('[data-pause]').textContent = userPaused ? 'Resume motion' : reduced.matches ? 'Motion reduced' : 'Pause motion';
  q('[data-pause]').setAttribute('aria-label', userPaused ? 'Resume animation' : 'Pause animation');
 };
 bind('[data-pause]','click', () => { userPaused = !userPaused; syncMotion(); });
 on(document,'visibilitychange',syncMotion);
 on(reduced,'change',syncMotion);
 on(window,'message',event => { if(event.source !== window.parent || !event.data || event.data.type !== 'discover-motion' || typeof event.data.paused !== 'boolean') return; parentPaused = event.data.paused; syncMotion(); });
 if(typeof IntersectionObserver !== 'undefined') { const observer = new IntersectionObserver(entries => {offscreen = !entries[0].isIntersecting;syncMotion();}); observer.observe(host);cleanups.push(() => observer.disconnect()); }
 ${scene.script}
 syncMotion();
 return () => {cleanups.forEach(cleanup => cleanup());root.replaceChildren();host.removeAttribute('data-motion-paused');};
}`;
 const page = (script: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(scene.title)}</title><style>html,body{margin:0;min-height:100%;background:${paper}}body{display:grid;place-items:center;min-height:100vh}#demo{width:min(100%,1000px)}</style></head><body><main id="demo"></main>${script}</body></html>`;
 const previewHtml = page(`<script>${implementation.replaceAll('</script', '<\\/script')};mountComponent(document.getElementById('demo'));</script>`);
 const coverArt = scene.art.replace('<svg ', '<svg x="70" y="20" width="660" height="440" ');
 const coverSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600"><rect width="800" height="600" fill="${paper}"/><g color="${ink}" style="--paper:${paper};--ink:${ink};--accent:${accent}">${coverArt}</g><path d="M48 480H752" stroke="${ink}" opacity=".2"/>${label(48, 512, 'ESTORI / MOTION STUDIES', 11, ink)}${label(48, 559, escape(scene.title), 34, ink)}${label(752, 555, scene.premium ? '03' : '0' + (['Shade Switcher','Ingredient Orbit','Recipe Steps','Material Samples','Waveform Loop','Member Mosaic','Gear Stack','Size Matcher'].includes(scene.title) ? 2 : 1), 18, ink).replace('font-family=', 'text-anchor="end" font-family=')}</svg>`;
 return {
  slug, title: scene.title, categorySlug: scene.categorySlug, kind: 'component', tier: scene.premium ? 'premium' : 'free', priceCents: scene.premium ? 900 : 0,
  summary: scene.summary, description: scene.description, tags: [...scene.tags, 'original', 'accessible'], features: [...scene.features, 'Keyboard and touch controls', 'Reduced motion and visibility-aware pause', 'Dependency-free reusable source'], palette: scene.palette, animationKey: slug, featured: !!scene.premium,
  previewHtml, coverSvg,
  files: [
   {path:'index.html',content:page('<script type="module">import {mountComponent} from "./component.js"; mountComponent(document.getElementById("demo"));</script>')},
   {path:'component.js',content:`/** ${scene.title} — original Estori component. No dependencies. */\nexport ${implementation}\n`},
   {path:'README.md',content:`# ${scene.title}\n\n${scene.description}\n\n## Run the demo\n\nServe this directory with a local static HTTP server (for example, \`bunx serve .\`) and open the printed URL. There is no build step and the component needs no packages, fonts, images, or network requests.\n\n## Reuse\n\n\`\`\`js\nimport { mountComponent } from './component.js';\nconst cleanup = mountComponent(document.querySelector('#your-container'));\n// Call cleanup() before removing the container or remounting.\n\`\`\`\n\nThe component renders into a Shadow DOM, so its CSS is isolated from your storefront. Change the --paper, --ink, and --accent values in component.js or edit the original SVG artwork and scene controls there. Mount once per host; call cleanup before mounting again.\n\n## Interaction\n\n${scene.features.map(feature => '- '+feature).join('\n')}\n\nButtons work with Enter/Space and touch. Range controls support arrow keys, Home/End, and touch dragging. Controls report their result in a polite live region.\n\n## Motion and embedding\n\nMotion respects prefers-reduced-motion, document visibility and viewport intersection. The pause button stops decorative animation. A containing iframe can also receive \`iframe.contentWindow.postMessage({ type: 'discover-motion', paused: true }, '*')\` from its parent; false resumes unless another pause condition remains active. No audio, analytics or external dependencies are included.\n\n## Provenance\n\nOriginal geometry, typography composition and motion authored for Estori. System fonts only; no third-party imagery.\n`},
  ],
 };
}
