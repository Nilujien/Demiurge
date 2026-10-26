import { Rng } from '../core/rng';
import { Material } from './palette';

type P3 = [number, number, number];
const TAU = Math.PI * 2;

/** Assembleur de maillages low-poly non indexés : (x, y, z, matériau) par sommet. */
class MeshBuilder {
  private readonly v: number[] = [];
  private o: P3 = [0, 0, 0];

  private tri(a: P3, b: P3, c: P3, m: number): void {
    for (const p of [a, b, c]) this.v.push(p[0] + this.o[0], p[1] + this.o[1], p[2] + this.o[2], m);
  }

  /** Décale les primitives suivantes. */
  at(x: number, y: number, z: number): this {
    this.o = [x, y, z];
    return this;
  }

  prism(r: number, y0: number, y1: number, seg: number, m: number): this {
    for (let k = 0; k < seg; k++) {
      const a0 = (k / seg) * TAU;
      const a1 = ((k + 1) / seg) * TAU;
      const p0: P3 = [Math.cos(a0) * r, y0, Math.sin(a0) * r];
      const p1: P3 = [Math.cos(a1) * r, y0, Math.sin(a1) * r];
      const q0: P3 = [p0[0], y1, p0[2]];
      const q1: P3 = [p1[0], y1, p1[2]];
      this.tri(p0, p1, q1, m);
      this.tri(p0, q1, q0, m);
    }
    return this;
  }

  cone(r: number, y0: number, y1: number, seg: number, m: number): this {
    for (let k = 0; k < seg; k++) {
      const a0 = (k / seg) * TAU;
      const a1 = ((k + 1) / seg) * TAU;
      this.tri(
        [Math.cos(a0) * r, y0, Math.sin(a0) * r],
        [Math.cos(a1) * r, y0, Math.sin(a1) * r],
        [0, y1, 0],
        m,
      );
    }
    return this;
  }

  ellipsoid(c: P3, rad: P3, seg: number, rings: number, m: number): this {
    const at = (t: number, a: number): P3 => [
      c[0] + Math.sin(t) * Math.cos(a) * rad[0],
      c[1] + Math.cos(t) * rad[1],
      c[2] + Math.sin(t) * Math.sin(a) * rad[2],
    ];
    for (let i = 0; i < rings; i++) {
      const t0 = (i / rings) * Math.PI;
      const t1 = ((i + 1) / rings) * Math.PI;
      for (let k = 0; k < seg; k++) {
        const a0 = (k / seg) * TAU;
        const a1 = ((k + 1) / seg) * TAU;
        const p00 = at(t0, a0);
        const p01 = at(t0, a1);
        const p10 = at(t1, a0);
        const p11 = at(t1, a1);
        this.tri(p00, p10, p11, m);
        this.tri(p00, p11, p01, m);
      }
    }
    return this;
  }

  build(): Float32Array {
    return new Float32Array(this.v);
  }
}

/** Silhouettes générées par espèce : chaque arbre en reçoit une selon sa case. */
export const TREE_VARIANTS = 4;
/** Graine des silhouettes : fixe, pour qu'un monde garde le même aspect d'une session à l'autre. */
const TREE_SHAPE_SEED = 0x7ee5;

type Range = (lo: number, hi: number) => number;

/** Feuillu : tronc, houppier principal et 1 à 3 masses secondaires autour du sommet. */
function broadleaf(r: Range): Float32Array {
  const { Trunk, Broadleaf } = Material;
  const top = r(0.6, 0.85);
  const crown = r(0.5, 0.64);
  const cy = top + crown * 0.55;
  const b = new MeshBuilder()
    .prism(r(0.09, 0.12), 0, top, 5, Trunk)
    .ellipsoid([0, cy, 0], [crown, crown * r(0.8, 0.95), crown], 6, 4, Broadleaf);
  const extra = Math.floor(r(1, 4));
  for (let k = 0; k < extra; k++) {
    const a = r(0, TAU);
    const d = crown * r(0.3, 0.55);
    const rad = crown * r(0.5, 0.68);
    b.ellipsoid(
      [Math.cos(a) * d, cy + crown * r(0.2, 0.75), Math.sin(a) * d],
      [rad, rad * 0.9, rad],
      5,
      3,
      Broadleaf,
    );
  }
  return b.build();
}

/** Conifère : tronc court et 2 à 4 étages de cônes qui se rétrécissent jusqu'à la pointe. */
function conifer(r: Range): Float32Array {
  const { Trunk, Conifer } = Material;
  const height = r(1.9, 2.6);
  const base = r(0.52, 0.68);
  const tiers = Math.floor(r(2, 5));
  const y0 = 0.3;
  const step = (height - y0) / (tiers + 0.8);
  const b = new MeshBuilder().prism(0.09, 0, 0.45, 5, Trunk);
  for (let t = 0; t < tiers; t++) {
    const f = tiers > 1 ? t / (tiers - 1) : 0;
    const bottom = y0 + t * step;
    b.cone(base * (1 - 0.5 * f), bottom, t === tiers - 1 ? height : bottom + step * 1.8, 6, Conifer);
  }
  return b.build();
}

/** Buisson : une masse basse et 1 à 3 touffes autour. */
function bush(r: Range): Float32Array {
  const { Broadleaf } = Material;
  const main = r(0.38, 0.48);
  const b = new MeshBuilder().ellipsoid([0, main * 0.72, 0], [main, main * 0.7, main], 6, 3, Broadleaf);
  const extra = Math.floor(r(1, 4));
  for (let k = 0; k < extra; k++) {
    const a = r(0, TAU);
    const d = r(0.18, 0.3);
    const rad = r(0.2, 0.3);
    b.ellipsoid(
      [Math.cos(a) * d, rad * 0.85 * r(1, 1.4), Math.sin(a) * d],
      [rad, rad * 0.85, rad],
      5,
      3,
      Broadleaf,
    );
  }
  return b.build();
}

/**
 * Arbres à l'échelle 1 (une cellule), base en y = 0. Index : espèce × TREE_VARIANTS + variante,
 * espèces dans l'ordre de TreeKind. Générés une fois au démarrage, de façon déterministe.
 */
export function buildTreeMeshes(): Float32Array[] {
  const rng = new Rng(TREE_SHAPE_SEED);
  const r: Range = (lo, hi) => lo + (hi - lo) * rng.next();
  const out: Float32Array[] = [];
  for (const gen of [broadleaf, conifer, bush]) {
    for (let v = 0; v < TREE_VARIANTS; v++) out.push(gen(r));
  }
  return out;
}

/** Accessoires instanciés comme les arbres : base en y = 0, face vers +x. */
export interface PropMeshes {
  villager: Float32Array;
  villagerWood: Float32Array;
  villagerGrain: Float32Array;
  house: Float32Array;
  cloud: Float32Array;
  smoke: Float32Array;
  drop: Float32Array;
}

/** Cheminée de la maison, en coordonnées du maillage : position sur le toit et sommet du conduit. */
export const CHIMNEY = { x: 0.25, z: 0, top: 1.18 } as const;

export function buildPropMeshes(): PropMeshes {
  const { Sand, Clay, Rock, Trunk, DryGrass, Snow, Water } = Material;
  const villager = (): MeshBuilder =>
    new MeshBuilder()
      .prism(0.07, 0, 0.22, 4, Trunk)
      .prism(0.12, 0.2, 0.5, 5, Water)
      .ellipsoid([0, 0.6, 0], [0.1, 0.1, 0.1], 5, 3, Sand);
  // Maison : murs d'argile carrés (prisme à 4 pans tourné de 45°) et toit de chaume.
  return {
    villager: villager().build(),
    villagerWood: villager().at(-0.15, 0, 0).prism(0.07, 0.25, 0.7, 4, Trunk).build(),
    villagerGrain: villager().ellipsoid([-0.15, 0.4, 0], [0.11, 0.14, 0.11], 5, 3, DryGrass).build(),
    house: new MeshBuilder()
      .prism(0.5, 0, 0.5, 4, Clay)
      .cone(0.68, 0.45, 1.05, 4, DryGrass)
      .at(CHIMNEY.x, 0, CHIMNEY.z)
      .prism(0.09, 0.6, CHIMNEY.top, 4, Rock)
      .build(),
    cloud: new MeshBuilder()
      .ellipsoid([0, 0, 0], [1, 0.38, 1], 7, 4, Snow)
      .ellipsoid([0.45, 0.22, 0.2], [0.55, 0.32, 0.55], 6, 3, Snow)
      .ellipsoid([-0.4, 0.15, -0.35], [0.5, 0.3, 0.5], 6, 3, Snow)
      .build(),
    smoke: new MeshBuilder().ellipsoid([0, 0, 0], [1, 0.8, 1], 6, 3, Snow).build(),
    drop: new MeshBuilder().prism(0.05, 0, 0.5, 3, Water).build(),
  };
}

/** Stades de croissance des céréales, chacun avec son maillage : vert, jaunissant, mûr (épis dorés). */
export const CROP_STAGES = 3;

/**
 * Touffe de céréales, base en y = 0 : trois tiges fines, et des épis pour le stade mûr.
 * Peu de facettes : un champ en compte neuf, et l'île des milliers.
 */
export function buildCropMeshes(): Float32Array[] {
  const { Grass, DryGrass, Sand } = Material;
  const blades: [number, number, number][] = [
    [0.08, 0.02, 0.55],
    [-0.07, 0.06, 0.46],
    [0.01, -0.08, 0.5],
  ];
  const tuft = (m: number, ears: boolean): Float32Array => {
    const b = new MeshBuilder();
    for (const [x, z, h] of blades) {
      b.at(x, 0, z).cone(0.07, 0, h, 3, ears ? DryGrass : m);
      // Épi : un fuseau (deux cônes opposés) au sommet de la tige.
      if (ears)
        b.at(x, 0, z)
          .cone(0.06, h - 0.02, h + 0.12, 3, m)
          .cone(0.06, h - 0.02, h - 0.1, 3, m);
    }
    return b.build();
  };
  return [tuft(Grass, false), tuft(DryGrass, false), tuft(Sand, true)];
}
