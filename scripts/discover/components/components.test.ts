import { describe, expect, it } from 'bun:test';
import { Parser } from 'htmlparser2';
import { buildComponentArtifacts } from '../components';
import { catalogCategories } from '../artifact-types';
import { buildSnapshot, parseBundle } from '../../../worker/services/templates/snapshot';

// These checks protect delivery: missing scenes, incorrect source prices, or broken bundles.
describe('deliverable motion catalog', () => {
 it('delivers all eight topics with two free components and one premium component each', () => {
  const artifacts = buildComponentArtifacts();
  expect(artifacts).toHaveLength(24);
  for (const category of catalogCategories) {
   const entries = artifacts.filter(entry => entry.categorySlug === category.slug);
   expect(entries).toHaveLength(3);
   expect(entries.filter(entry => entry.tier === 'free').map(entry => entry.priceCents)).toEqual([0, 0]);
   expect(entries.filter(entry => entry.tier === 'premium').map(entry => entry.priceCents)).toEqual([900]);
  }
  expect(new Set(artifacts.map(entry => entry.slug)).size).toBe(24);
  expect(new Set(artifacts.map(entry => entry.animationKey)).size).toBe(24);
 });
 it('ships runnable original demos and dependency-free reusable modules for every entry', () => {
  for (const entry of buildComponentArtifacts()) {
   const files = new Map(entry.files.map(file => [file.path, file.content]));
   expect(entry.kind).toBe('component');
   expect(files.has('index.html')).toBe(true);
   expect(files.has('component.js')).toBe(true);
   expect(files.has('README.md')).toBe(true);
   expect(files.get('index.html')).toContain('./component.js');
   expect(files.get('component.js')).toContain('export function mountComponent');
   expect(() => new Function(files.get('component.js')!.replace('export function', 'function'))).not.toThrow();
   expect(entry.previewHtml).not.toMatch(/<script[^>]+src=|<link[^>]+href=|fetch\s*\(|https?:\/\/(?!www.w3.org\/2000\/svg)/);
   expect(entry.coverSvg).toContain('<svg');
  }
 });
 it('survives the production source-bundle safety scan and byte round trip', () => {
  for (const entry of buildComponentArtifacts()) {
   const snapshot = buildSnapshot(entry.files.map(file => ({ path: file.path, bytes: new TextEncoder().encode(file.content) })));
   expect(snapshot.ok).toBe(true);
   if (!snapshot.ok) throw new Error(snapshot.error);
   const restored = parseBundle(JSON.stringify(snapshot.bundle));
   expect(restored).toHaveLength(3);
   for (const file of restored) expect(new TextDecoder().decode(file.bytes)).toBe(entry.files.find(original => original.path === file.path)!.content);
  }
 });
 it('emits quoted values for all SVG attributes so standalone image XML can decode', () => {
  const invalid: string[] = [];
  for (const entry of buildComponentArtifacts()) {
   const parser = new Parser({
    onattribute(name, _value, quote) {
     if (quote !== '"' && quote !== "'") invalid.push(entry.slug + ': ' + name);
    },
   }, { xmlMode: true });
   parser.end(entry.coverSvg);
  }
  expect(invalid).toEqual([]);
 });
 it('does not collapse the inventory into duplicate scenes', () => {
  const artifacts = buildComponentArtifacts();
  expect(new Set(artifacts.map(entry => entry.previewHtml)).size).toBe(24);
  expect(new Set(artifacts.map(entry => entry.coverSvg)).size).toBe(24);
  expect(artifacts.every(entry => entry.features.length >= 3 && entry.tags.length >= 3)).toBe(true);
 });
});
