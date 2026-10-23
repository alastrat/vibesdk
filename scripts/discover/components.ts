import type { CatalogArtifact } from './artifact-types';
import { buildScene } from './components/core';
import { fashionScenes } from './components/fashion';
import { beautyScenes } from './components/beauty';
import { foodScenes } from './components/food';
import { homeScenes } from './components/home';
import { artScenes } from './components/art';
import { learningScenes } from './components/learning';
import { outdoorScenes } from './components/outdoors';
import { petScenes } from './components/pets';

/** Deterministic, original, self-contained motion artifacts for the public catalog. */
export function buildComponentArtifacts(): CatalogArtifact[] {
 return [...fashionScenes, ...beautyScenes, ...foodScenes, ...homeScenes, ...artScenes, ...learningScenes, ...outdoorScenes, ...petScenes].map(buildScene);
}
