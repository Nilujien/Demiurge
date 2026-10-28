import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/simulation';
import { Soil } from '../src/sim/soils';
import { HISTORY_DEPTH, StrokeHistory } from '../src/tools/history';
import { applyTool, type Stroke, type ToolId } from '../src/tools/tools';

const stroke = (over: Partial<Stroke> = {}): Stroke => ({
  x: 16,
  z: 16,
  radius: 3,
  dt: 0.1,
  soil: Soil.Clay,
  flattenTo: 0,
  random: () => 0,
  ...over,
});

/** Un geste de plusieurs images, enregistré. */
function gesture(
  sim: Simulation,
  h: StrokeHistory,
  tool: ToolId,
  over: Partial<Stroke> = {},
  frames = 5,
): void {
  h.begin(tool);
  for (let k = 0; k < frames; k++) applyTool(sim, tool, stroke(over), h);
  h.end();
}

describe('StrokeHistory', () => {
  it('annule puis rétablit un coup de pinceau sur le relief', () => {
    const sim = new Simulation(1, 32);
    const h = new StrokeHistory(sim.world);
    const before = sim.world.height.slice();
    gesture(sim, h, 'raise');
    const after = sim.world.height.slice();
    expect(after).not.toEqual(before);
    expect(h.canUndo).toBe(true);

    sim.dirty.heights = false;
    expect(h.undo(sim)).toBe('raise');
    expect(sim.world.height).toEqual(before);
    expect(sim.dirty.heights).toBe(true);
    expect(h.canRedo).toBe(true);

    expect(h.redo(sim)).toBe('raise');
    expect(sim.world.height).toEqual(after);
  });

  it('ne restaure que les cellules touchées par le geste', () => {
    const sim = new Simulation(1, 32);
    const w = sim.world;
    const h = new StrokeHistory(w);
    gesture(sim, h, 'fertilize');
    const far = w.index(2, 2);
    w.fertility[far] = 0.42;
    h.undo(sim);
    expect(w.fertility[far]).toBeCloseTo(0.42);
  });

  it('restaure les arbres abattus, sauf là où un champ a depuis été labouré', () => {
    const sim = new Simulation(1, 32);
    const w = sim.world;
    const h = new StrokeHistory(w);
    const a = w.index(16, 16);
    const b = w.index(17, 16);
    w.tree[a] = 0.8;
    w.tree[b] = 0.8;
    gesture(sim, h, 'cut', {}, 1);
    expect(w.tree[a]).toBe(0);
    w.field[b] = 1;
    h.undo(sim);
    expect(w.tree[a]).toBeCloseTo(0.8);
    expect(w.tree[b]).toBe(0);
  });

  it("n'enregistre pas les gestes sans effet sur la grille", () => {
    const sim = new Simulation(1, 32);
    const h = new StrokeHistory(sim.world);
    gesture(sim, h, 'rain');
    expect(h.canUndo).toBe(false);
  });

  it('un nouveau geste efface ce qui pouvait être rétabli', () => {
    const sim = new Simulation(1, 32);
    const h = new StrokeHistory(sim.world);
    gesture(sim, h, 'raise');
    h.undo(sim);
    gesture(sim, h, 'lower');
    expect(h.canRedo).toBe(false);
  });

  it('borne la profondeur de l’historique', () => {
    const sim = new Simulation(1, 32);
    const h = new StrokeHistory(sim.world);
    for (let k = 0; k < HISTORY_DEPTH + 5; k++) gesture(sim, h, 'raise', {}, 1);
    let undone = 0;
    while (h.undo(sim)) undone++;
    expect(undone).toBe(HISTORY_DEPTH);
  });
});
