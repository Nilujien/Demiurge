import { describe, expect, it } from 'vitest';
import { buildTreeMeshes, TREE_VARIANTS } from '../src/render/meshes';
import { TREE_KINDS } from '../src/sim/soils';

/** Budget par silhouette : un arbre est instancié des milliers de fois. */
const MAX_VERTICES = 600;

function bounds(mesh: Float32Array): { r: number; y0: number; y1: number } {
  let r = 0;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let k = 0; k < mesh.length; k += 4) {
    r = Math.max(r, Math.hypot(mesh[k], mesh[k + 2]));
    y0 = Math.min(y0, mesh[k + 1]);
    y1 = Math.max(y1, mesh[k + 1]);
  }
  return { r, y0, y1 };
}

describe('buildTreeMeshes', () => {
  const meshes = buildTreeMeshes();

  it('fournit TREE_VARIANTS silhouettes par espèce', () => {
    expect(meshes).toHaveLength(TREE_KINDS * TREE_VARIANTS);
  });

  it('est déterministe', () => {
    expect(buildTreeMeshes()).toEqual(meshes);
  });

  it('produit des silhouettes différentes au sein d’une espèce', () => {
    for (let kind = 0; kind < TREE_KINDS; kind++) {
      const variants = meshes.slice(kind * TREE_VARIANTS, (kind + 1) * TREE_VARIANTS);
      expect(new Set(variants.map((m) => m.join(','))).size).toBe(TREE_VARIANTS);
    }
  });

  it('reste dans sa case, posé au sol et sous le budget de sommets', () => {
    meshes.forEach((m) => {
      const vertices = m.length / 4;
      expect(vertices % 3).toBe(0);
      expect(vertices).toBeLessThanOrEqual(MAX_VERTICES);
      const b = bounds(m);
      expect(b.r).toBeLessThan(1);
      expect(b.y0).toBeGreaterThanOrEqual(-0.01);
      expect(b.y1).toBeLessThan(2.8);
    });
  });

  it('garde des gabarits distincts : buissons bas, conifères les plus hauts', () => {
    const top = (kind: number): number[] =>
      meshes.slice(kind * TREE_VARIANTS, (kind + 1) * TREE_VARIANTS).map((m) => bounds(m).y1);
    expect(Math.max(...top(2))).toBeLessThan(0.8);
    expect(Math.min(...top(1))).toBeGreaterThan(Math.max(...top(0)) - 0.2);
  });
});
