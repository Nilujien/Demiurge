import { ACTIVITIES, Activity } from '../sim/people';
import { hexToRgb } from './gl';

/** Bulle d'activité : largeur et hauteur en pixels basse résolution, pointe comprise. */
export const BUBBLE_W = 12;
export const BUBBLE_H = 14;

const INK = '#15142a';
const PAPER = '#f2ead2';

/** Pictogrammes 8×8 (« # » = pixel plein) et leur couleur, indexés par `Activity`. */
const ICONS: Record<number, { color: string; rows: readonly string[] }> = {
  [Activity.Chop]: {
    color: '#6b4630',
    rows: ['....##..', '...####.', '...#####', '...####.', '..#.##..', '.#......', '#.......', '........'],
  },
  [Activity.Terrace]: {
    color: '#565a68',
    rows: ['........', '##......', '##......', '####....', '####....', '######..', '######..', '########'],
  },
  [Activity.Till]: {
    color: '#7d5636',
    rows: ['.....##.', '....##..', '...##...', '..##....', '.##.....', '#.......', '#.#.#.#.', '.#.#.#.#'],
  },
  [Activity.Sow]: {
    color: '#2f6b3a',
    rows: ['...#....', '..###...', '...#....', '.#...#..', '###.###.', '.#...#..', '........', '########'],
  },
  [Activity.Harvest]: {
    color: '#b8955e',
    rows: ['.#.#.#..', '#####...', '.###.#..', '..#.###.', '..#..#..', '..#..#..', '..#..#..', '..#..#..'],
  },
  [Activity.Build]: {
    color: '#94503a',
    rows: ['...##...', '..####..', '.######.', '########', '.#....#.', '.#.##.#.', '.#.##.#.', '.######.'],
  },
  [Activity.Wood]: {
    color: '#6b4630',
    rows: ['........', '.######.', '#.####.#', '.######.', '#.####.#', '.######.', '#.####.#', '........'],
  },
  [Activity.Grain]: {
    color: '#93984a',
    rows: ['...##...', '..#..#..', '..####..', '.######.', '########', '########', '########', '.######.'],
  },
  [Activity.Hungry]: {
    color: '#c0392b',
    rows: ['...##...', '...##...', '...##...', '...##...', '...##...', '........', '...##...', '...##...'],
  },
};

/**
 * Atlas RGBA des bulles : une case de BUBBLE_W × BUBBLE_H par activité, ligne 0 en haut.
 * La case `Activity.None` reste vide (aucune bulle).
 */
export function buildBubbleAtlas(): Uint8Array {
  const width = BUBBLE_W * ACTIVITIES;
  const out = new Uint8Array(width * BUBBLE_H * 4);
  const ink = hexToRgb(INK);
  const paper = hexToRgb(PAPER);
  const set = (x: number, y: number, rgb: readonly number[]): void => {
    const k = (y * width + x) * 4;
    out[k] = rgb[0] * 255;
    out[k + 1] = rgb[1] * 255;
    out[k + 2] = rgb[2] * 255;
    out[k + 3] = 255;
  };
  for (let a = 1; a < ACTIVITIES; a++) {
    const icon = ICONS[a];
    if (!icon) continue;
    const x0 = a * BUBBLE_W;
    // Corps de la bulle : rectangle aux coins coupés, bordé d'encre.
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < 12; x++) {
        const corner = (x === 0 || x === 11) && (y === 0 || y === 11);
        if (corner) continue;
        const edge = x === 0 || x === 11 || y === 0 || y === 11;
        set(x0 + x, y, edge ? ink : paper);
      }
    }
    // Pointe vers la tête de l'habitant.
    for (const x of [5, 6]) set(x0 + x, 11, paper);
    for (const [x, y] of [
      [4, 12],
      [7, 12],
      [5, 13],
      [6, 13],
    ]) {
      set(x0 + x, y, ink);
    }
    for (const x of [5, 6]) set(x0 + x, 12, paper);
    const rgb = hexToRgb(icon.color);
    icon.rows.forEach((row, y) =>
      [...row].forEach((ch, x) => {
        if (ch === '#') set(x0 + 2 + x, 2 + y, rgb);
      }),
    );
  }
  return out;
}
