export const Soil = { Sand: 0, Humus: 1, Clay: 2, Rock: 3 } as const;
export type SoilId = (typeof Soil)[keyof typeof Soil];

export interface SoilDef {
  readonly id: SoilId;
  readonly name: string;
  /** Couleur de l'interface (la couleur du rendu vient de la palette). */
  readonly swatch: string;
  /** Aptitude à porter de l'herbe et des arbres (0 = stérile). */
  readonly grass: number;
  readonly trees: number;
  /** Perte d'humidité par pas : évaporation + drainage profond. */
  readonly evaporation: number;
  /** Part de l'humidité qui ruisselle vers l'aval, selon la pente. */
  readonly runoff: number;
  /** Contribution d'une cellule au bassin versant (formation des cours d'eau). */
  readonly catchment: number;
}

export const SOILS: readonly SoilDef[] = [
  {
    id: 0,
    name: 'Sable',
    swatch: '#d9bb7b',
    grass: 0.35,
    trees: 0.35,
    evaporation: 0.022,
    runoff: 0.25,
    catchment: 0.3,
  },
  {
    id: 1,
    name: 'Humus',
    swatch: '#7d5636',
    grass: 1,
    trees: 1,
    evaporation: 0.008,
    runoff: 0.4,
    catchment: 0.6,
  },
  {
    id: 2,
    name: 'Argile',
    swatch: '#b86b47',
    grass: 0.6,
    trees: 0.7,
    evaporation: 0.005,
    runoff: 0.7,
    catchment: 0.9,
  },
  {
    id: 3,
    name: 'Roche',
    swatch: '#767b88',
    grass: 0,
    trees: 0,
    evaporation: 0.03,
    runoff: 1,
    catchment: 1.2,
  },
];

export const soilDef = (id: number): SoilDef => SOILS[id] ?? SOILS[1];

export const TreeKind = { Broadleaf: 0, Conifer: 1, Bush: 2 } as const;
export type TreeKindId = (typeof TreeKind)[keyof typeof TreeKind];
export const TREE_KINDS = 3;
