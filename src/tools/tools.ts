import { BASE, H_MAX, SNOW_LINE } from '../config';
import { hash2 } from '../core/noise';
import type { Simulation } from '../sim/simulation';
import { Soil, soilDef, type SoilId } from '../sim/soils';

export type ToolId = 'raise' | 'lower' | 'flatten' | 'soil' | 'fertilize' | 'seed' | 'water' | 'cut';

export interface ToolDef {
  readonly id: ToolId;
  readonly label: string;
  readonly key: string;
  /** Couleur de l'icône et de l'anneau du pinceau. */
  readonly color: string;
  /** Icône 8×8 : « # » = pixel plein. */
  readonly icon: readonly string[];
}

export const TOOLS: readonly ToolDef[] = [
  {
    id: 'raise',
    label: 'Élever',
    key: '1',
    color: '#ffe9a8',
    icon: ['...##...', '..####..', '.######.', '...##...', '...##...', '...##...', '########', '########'],
  },
  {
    id: 'lower',
    label: 'Creuser',
    key: '2',
    color: '#ff9b7a',
    icon: ['########', '########', '...##...', '...##...', '...##...', '.######.', '..####..', '...##...'],
  },
  {
    id: 'flatten',
    label: 'Aplanir',
    key: '3',
    color: '#c9d7ff',
    icon: ['........', '........', '#......#', '########', '########', '#.#.#.#.', '.#.#.#.#', '........'],
  },
  {
    id: 'soil',
    label: 'Sol',
    key: '4',
    color: '#d9bb7b',
    icon: ['##.##.##', '#.###.##', '########', '.##.####', '########', '##.###.#', '########', '#.##.###'],
  },
  {
    id: 'fertilize',
    label: 'Fertiliser',
    key: '5',
    color: '#b6f07a',
    icon: ['...#....', '...#....', '.#.#.#..', '..###...', '#######.', '..###...', '.#.#.#..', '...#....'],
  },
  {
    id: 'seed',
    label: 'Semer',
    key: '6',
    color: '#7cf0b0',
    icon: ['...##...', '..####..', '.######.', '########', '.######.', '...##...', '...##...', '..####..'],
  },
  {
    id: 'water',
    label: 'Arroser',
    key: '7',
    color: '#82c9e0',
    icon: ['...#....', '..###...', '..###...', '.#####..', '.#####..', '.##.##..', '..###...', '........'],
  },
  {
    id: 'cut',
    label: 'Abattre',
    key: '8',
    color: '#e0a070',
    icon: ['..##....', '.####...', '######..', '.#####..', '..#.##..', '....##..', '.....##.', '......##'],
  },
];

export const toolDef = (id: ToolId): ToolDef => TOOLS.find((t) => t.id === id) ?? TOOLS[0];

/** Un coup de pinceau appliqué pendant `dt` secondes autour du point (x, z). */
export interface Stroke {
  x: number;
  z: number;
  radius: number;
  dt: number;
  soil: SoilId;
  /** Altitude visée par « Aplanir » (relevée au début du geste). */
  flattenTo: number;
  /** Tirage aléatoire [0, 1) ; injecté pour garder les outils testables. */
  random: () => number;
}

const TERRAFORM_SPEED = 7;

export function applyTool(sim: Simulation, tool: ToolId, s: Stroke): void {
  const w = sim.world;
  const { n, height, soil, fertility, tree, moisture } = w;
  const r = s.radius;
  const x0 = Math.max(0, Math.floor(s.x - r));
  const x1 = Math.min(n - 1, Math.ceil(s.x + r));
  const z0 = Math.max(0, Math.floor(s.z - r));
  const z1 = Math.min(n - 1, Math.ceil(s.z + r));

  for (let z = z0; z <= z1; z++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - s.x, z - s.z);
      if (d > r) continue;
      const k = 1 - (d / r) ** 2;
      const f = k * k; // atténuation douce vers le bord du pinceau
      const i = z * n + x;
      switch (tool) {
        case 'raise':
          height[i] = Math.min(H_MAX - 1, height[i] + f * TERRAFORM_SPEED * s.dt);
          break;
        case 'lower':
          height[i] = Math.max(BASE + 1.5, height[i] - f * TERRAFORM_SPEED * s.dt);
          break;
        case 'flatten':
          height[i] += (s.flattenTo - height[i]) * Math.min(1, f * 8 * s.dt);
          break;
        case 'soil':
          if (d < r * (0.75 + 0.25 * hash2(x, z, 7))) soil[i] = s.soil;
          break;
        case 'fertilize':
          if (soil[i] !== Soil.Rock) fertility[i] = Math.min(1, fertility[i] + f * 1.5 * s.dt);
          break;
        case 'seed':
          if (
            tree[i] === 0 &&
            height[i] > w.seaLevel + 0.1 &&
            height[i] < SNOW_LINE &&
            soilDef(soil[i]).trees > 0 &&
            s.random() < f * s.dt * 4 &&
            w.orthogonalFree(x, z)
          ) {
            sim.plant(i);
            fertility[i] = Math.max(fertility[i], 0.35);
          }
          break;
        case 'water':
          if (height[i] >= w.seaLevel) moisture[i] = Math.min(1, moisture[i] + f * 2.5 * s.dt);
          break;
        case 'cut':
          if (tree[i] > 0 && d < r * (0.8 + 0.2 * hash2(x, z, 13))) tree[i] = 0;
          break;
      }
    }
  }

  const terraform = tool === 'raise' || tool === 'lower' || tool === 'flatten';
  if (terraform) sim.dirty.heights = true;
  sim.dirty.state = true;
  if (tool === 'seed' || tool === 'cut' || terraform) sim.dirty.trees = true;
  if (tool !== 'fertilize') sim.flowDirty = true;
}
