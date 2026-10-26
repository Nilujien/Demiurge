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

/** Arbres à l'échelle 1 (une cellule), base en y = 0. Indexés par TreeKind. */
export function buildTreeMeshes(): Float32Array[] {
  const { Trunk, Broadleaf, Conifer } = Material;
  return [
    new MeshBuilder()
      .prism(0.11, 0, 0.75, 5, Trunk)
      .ellipsoid([0, 1.05, 0], [0.62, 0.55, 0.62], 6, 4, Broadleaf)
      .ellipsoid([0.22, 1.45, 0.1], [0.38, 0.34, 0.38], 5, 3, Broadleaf)
      .build(),
    new MeshBuilder()
      .prism(0.09, 0, 0.45, 5, Trunk)
      .cone(0.62, 0.3, 1.25, 6, Conifer)
      .cone(0.47, 0.85, 1.85, 6, Conifer)
      .cone(0.3, 1.4, 2.35, 6, Conifer)
      .build(),
    new MeshBuilder()
      .ellipsoid([0, 0.28, 0], [0.45, 0.32, 0.45], 6, 3, Broadleaf)
      .ellipsoid([0.25, 0.35, 0.15], [0.28, 0.25, 0.28], 5, 3, Broadleaf)
      .build(),
  ];
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
