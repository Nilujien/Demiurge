import type { Simulation } from '../sim/simulation';
import type { World } from '../sim/world';
import type { ToolId } from './tools';

/** Grandeurs de `World` qu'un outil peut modifier. */
type Layer = 'height' | 'soil' | 'fertility' | 'tree' | 'treeKind';

/** Ce que chaque outil réversible modifie. Pluie et Peupler n'agissent pas sur la grille : ils ne s'annulent pas. */
const LAYERS: Partial<Record<ToolId, readonly Layer[]>> = {
  raise: ['height'],
  lower: ['height'],
  flatten: ['height'],
  soil: ['soil'],
  fertilize: ['fertility'],
  seed: ['tree', 'treeKind', 'fertility'],
  cut: ['tree'],
};

/** Nombre de gestes conservés. */
export const HISTORY_DEPTH = 40;

interface Entry {
  readonly tool: ToolId;
  readonly layers: readonly Layer[];
  readonly cells: Int32Array;
  /** Valeurs par grandeur, dans l'ordre de `cells`. */
  readonly before: Float32Array[];
  readonly after: Float32Array[];
}

/**
 * Annuler / rétablir les coups de pinceau. Pendant un geste, chaque cellule touchée pour la première fois
 * est photographiée avant modification ; à la fin du geste, on relève ses nouvelles valeurs. Seules ces
 * cellules sont restaurées : le reste de la simulation continue de vivre.
 */
export class StrokeHistory {
  private readonly undoStack: Entry[] = [];
  private readonly redoStack: Entry[] = [];
  private readonly marked: Uint8Array;
  private tool: ToolId | null = null;
  private layers: readonly Layer[] = [];
  private cells: number[] = [];
  private before: number[][] = [];

  constructor(private readonly world: World) {
    this.marked = new Uint8Array(world.cells);
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Outil du geste en cours d'enregistrement, null hors geste. */
  get recording(): ToolId | null {
    return this.tool;
  }

  begin(tool: ToolId): void {
    this.end();
    const layers = LAYERS[tool] ?? [];
    this.tool = tool;
    this.layers = layers;
    this.before = layers.map(() => []);
  }

  /** À appeler avant que l'outil ne modifie la cellule `i`. */
  touch(i: number): void {
    if (!this.tool || this.marked[i]) return;
    this.marked[i] = 1;
    this.cells.push(i);
    this.layers.forEach((l, k) => this.before[k].push(this.world[l][i]));
  }

  /** Clôt le geste ; il n'est conservé que s'il a changé quelque chose. */
  end(): void {
    const tool = this.tool;
    if (!tool) return;
    this.tool = null;
    const cells = Int32Array.from(this.cells);
    for (const i of cells) this.marked[i] = 0;
    this.cells = [];
    const before = this.before.map((v) => Float32Array.from(v));
    const after = this.layers.map((l) => Float32Array.from(cells, (i) => this.world[l][i]));
    const changed = before.some((b, k) => b.some((v, j) => v !== after[k][j]));
    if (!changed) return;
    this.undoStack.push({ tool, layers: this.layers, cells, before, after });
    if (this.undoStack.length > HISTORY_DEPTH) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  /** Annule le dernier geste ; retourne l'outil concerné, ou null s'il n'y avait rien à annuler. */
  undo(sim: Simulation): ToolId | null {
    this.end();
    const e = this.undoStack.pop();
    if (!e) return null;
    this.apply(sim, e, e.before);
    this.redoStack.push(e);
    return e.tool;
  }

  redo(sim: Simulation): ToolId | null {
    this.end();
    const e = this.redoStack.pop();
    if (!e) return null;
    this.apply(sim, e, e.after);
    this.undoStack.push(e);
    return e.tool;
  }

  /** Oublie tout, par exemple quand un nouveau monde est généré. */
  clear(): void {
    this.end();
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }

  private apply(sim: Simulation, e: Entry, values: Float32Array[]): void {
    const w = this.world;
    e.layers.forEach((l, k) => {
      const dst = w[l];
      const src = values[k];
      e.cells.forEach((i, j) => {
        // Un arbre ne repousse pas là où les habitants ont depuis bâti ou labouré.
        if (l === 'tree' && src[j] > 0 && (w.field[i] || w.building[i])) return;
        dst[i] = src[j];
      });
    });
    if (e.layers.includes('height')) sim.dirty.heights = true;
    sim.dirty.state = true;
    sim.dirty.trees = true;
    sim.flowDirty = true;
  }
}
