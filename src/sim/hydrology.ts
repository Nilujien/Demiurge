import { clamp, smoothstep } from '../core/math';
import { SOILS, soilDef } from './soils';
import type { World } from './world';

/** Voisinage D8 : est, sud-est, sud, sud-ouest, ouest, nord-ouest, nord, nord-est. */
export const D8_DX = [1, 1, 0, -1, -1, -1, 0, 1] as const;
export const D8_DZ = [0, 1, 1, 1, 0, -1, -1, -1] as const;
export const D8_DIST = D8_DX.map((dx, k) => Math.hypot(dx, D8_DZ[k]));

/** Paramètres des sols en tableaux indexés par identifiant : accès direct dans les boucles serrées. */
const RUNOFF = Float32Array.from(SOILS, (s) => s.runoff);
const EVAPORATION = Float32Array.from(SOILS, (s) => s.evaporation);

export const HYDRO = {
  /** Pluie reçue par pas ; majorée en altitude (effet orographique). */
  rain: 0.0038,
  rainHighlandBonus: 1.4,
  highlandAltitude: 8,
  /** Plafond de la part ruisselée par pas. */
  maxRunoff: 0.25,
  runoffSlopeScale: 0.05,
  /** Recharge par la nappe des cellules en bord d'eau. */
  shoreRecharge: 0.04,
  /** Seuils de surface drainée entre lesquels un cours d'eau apparaît puis s'élargit. */
  streamMin: 14,
  streamMax: 140,
} as const;

/**
 * Hydrologie en deux volets :
 * - `computeFlow` : réseau d'écoulement D8 et accumulation de flux → cours d'eau ;
 * - `step` : humidité du sol (pluie, ruissellement diffus vers l'aval, évaporation).
 */
export class Hydrology {
  private readonly order: Uint32Array;
  private readonly donors: Uint8Array;
  private readonly next: Float32Array;
  private readonly weight = new Float32Array(8);
  private readonly target = new Int32Array(8);

  constructor(private readonly world: World) {
    this.order = new Uint32Array(world.cells);
    this.donors = new Uint8Array(world.cells);
    this.next = new Float32Array(world.cells);
  }

  computeFlow(): void {
    const w = this.world;
    const { n, height, flowDir, flowAcc, stream, soil, tree, grass, moisture } = w;
    const donors = this.donors;
    donors.fill(0);

    for (let z = 0; z < n; z++) {
      for (let x = 0; x < n; x++) {
        const i = z * n + x;
        let best = 0;
        let dir = -1;
        for (let k = 0; k < 8; k++) {
          const xx = x + D8_DX[k];
          const zz = z + D8_DZ[k];
          if (xx < 0 || zz < 0 || xx >= n || zz >= n) continue;
          const drop = (height[i] - height[zz * n + xx]) / D8_DIST[k];
          if (drop > best) {
            best = drop;
            dir = k;
          }
        }
        flowDir[i] = dir;
        if (dir >= 0) donors[i + D8_DZ[dir] * n + D8_DX[dir]]++;
      }
    }

    // Des sommets vers les vallées : une cellule transmet son flux à sa voisine aval une fois
    // qu'elle a reçu celui de toutes ses donneuses (ordre topologique, sans tri : O(n)).
    const queue = this.order;
    let head = 0;
    let tail = 0;
    for (let i = 0; i < w.cells; i++) if (donors[i] === 0) queue[tail++] = i;
    flowAcc.fill(0);
    while (head < tail) {
      const i = queue[head++];
      const d = flowDir[i];
      const j = d >= 0 ? i + D8_DZ[d] * n + D8_DX[d] : -1;
      if (height[i] >= w.seaLevel) {
        const cover = (1 - 0.45 * Math.min(1, tree[i])) * (1 - 0.2 * grass[i]);
        flowAcc[i] += soilDef(soil[i]).catchment * cover * (0.5 + moisture[i]);
        if (j >= 0 && height[j] >= w.seaLevel) flowAcc[j] += flowAcc[i];
      }
      if (j >= 0 && --donors[j] === 0) queue[tail++] = j;
    }
    for (let i = 0; i < w.cells; i++) {
      stream[i] = height[i] < w.seaLevel ? 0 : smoothstep(HYDRO.streamMin, HYDRO.streamMax, flowAcc[i]);
    }
  }

  step(): void {
    const w = this.world;
    const { n, height, moisture, soil, grass, tree, stream } = w;
    const sea = w.seaLevel;
    const next = this.next;
    const weight = this.weight;
    const target = this.target;
    next.set(moisture);

    for (let z = 0; z < n; z++) {
      for (let x = 0; x < n; x++) {
        const i = z * n + x;
        const h = height[i];
        if (h < sea) {
          next[i] = 1;
          continue;
        }
        next[i] += HYDRO.rain * (h > HYDRO.highlandAltitude ? HYDRO.rainHighlandBonus : 1);

        // Un seul passage sur les voisines : pentes descendantes mémorisées pour la répartition.
        let slopeSum = 0;
        let nearWater = false;
        let count = 0;
        for (let k = 0; k < 8; k++) {
          const xx = x + D8_DX[k];
          const zz = z + D8_DZ[k];
          if (xx < 0 || zz < 0 || xx >= n || zz >= n) continue;
          const j = zz * n + xx;
          const hj = height[j];
          if (hj < sea && k % 2 === 0) nearWater = true;
          const d = h - hj;
          if (d > 0) {
            const s = d / D8_DIST[k];
            slopeSum += s;
            if (hj >= sea) {
              weight[count] = s;
              target[count++] = j;
            }
          }
        }
        if (slopeSum > 0) {
          const out =
            moisture[i] * Math.min(HYDRO.maxRunoff, RUNOFF[soil[i]] * slopeSum * HYDRO.runoffSlopeScale);
          next[i] -= out;
          const share = out / slopeSum;
          for (let c = 0; c < count; c++) next[target[c]] += share * weight[c];
        }
        if (nearWater) next[i] += HYDRO.shoreRecharge * (1 - moisture[i]);
      }
    }

    for (let i = 0; i < w.cells; i++) {
      if (height[i] < sea) {
        moisture[i] = 1;
        continue;
      }
      const shade = 1 - 0.3 * grass[i] - 0.25 * (tree[i] > 0.5 ? 1 : 0);
      let m = next[i] * (1 - EVAPORATION[soil[i]] * shade);
      if (stream[i] > 0) m = Math.max(m, 0.9 * stream[i]);
      moisture[i] = clamp(m, 0, 1);
    }
  }
}
