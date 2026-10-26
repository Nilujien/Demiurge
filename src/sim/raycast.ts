import { BASE, H_MAX } from '../config';
import type { Vec3 } from '../core/math';
import type { World } from './world';

/**
 * Premier point d'impact d'un rayon sur le relief : marche à pas fixe puis dichotomie.
 * Retourne null si le rayon ne touche pas la grille.
 */
export function raycastTerrain(world: World, origin: Vec3, dir: Vec3, step = 0.4): Vec3 | null {
  if (dir[1] >= 0) return null;
  const at = (t: number): Vec3 => [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t];
  const below = (t: number): boolean => {
    const p = at(t);
    return p[1] <= world.heightAt(p[0], p[2]);
  };
  const tEnd = (origin[1] - BASE) / -dir[1];
  let t = Math.max(0, (origin[1] - H_MAX) / -dir[1]);
  let prev = t;
  for (; t < tEnd; t += step) {
    if (below(t)) {
      let a = prev;
      let b = t;
      for (let k = 0; k < 8; k++) {
        const m = (a + b) / 2;
        if (below(m)) b = m;
        else a = m;
      }
      return at(b);
    }
    prev = t;
  }
  return null;
}
