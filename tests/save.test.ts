import { describe, expect, it } from 'vitest';
import { decodeSave, encodeSave, packSave, SaveError, unpackSave } from '../src/sim/save';
import { Simulation, WORLD_LAYERS } from '../src/sim/simulation';

const meta = { seed: 99, savedAt: 1_700_000_000_000 };

function run(sim: Simulation, ticks: number): void {
  for (let t = 0; t < ticks; t++) {
    sim.tick();
    if (t % 16 === 0) sim.updateFlow();
  }
}

function expectSame(a: Simulation, b: Simulation): void {
  for (const l of WORLD_LAYERS) expect(b.world[l], l).toEqual(a.world[l]);
  expect(b.ticks).toBe(a.ticks);
  expect(b.weather.clouds).toEqual(a.weather.clouds);
  const strip = (s: Simulation) => s.people.villagers.map(({ tribe, ...v }) => ({ ...v, tribe: tribe.id }));
  expect(strip(b)).toEqual(strip(a));
  expect(b.people.tribes.map((t) => ({ ...t }))).toEqual(a.people.tribes.map((t) => ({ ...t })));
}

describe('sauvegarde', () => {
  it('reprend exactement la même suite après un aller-retour par fichier', async () => {
    const a = new Simulation(99, 64);
    run(a, 60);
    a.rain(30, 30, 5, 0.5);
    const bytes = await encodeSave({ meta, state: a.save() });

    const b = new Simulation(5, 64);
    const file = await decodeSave(bytes);
    expect(file.meta).toEqual(meta);
    b.load(file.state);
    expectSame(a, b);

    run(a, 80);
    run(b, 80);
    expectSame(a, b);
    expect(a.people.population).toBeGreaterThan(0);
  });

  it('les habitants pointent vers leur village après chargement', () => {
    const a = new Simulation(99, 64);
    run(a, 20);
    const b = new Simulation(1, 64);
    b.load(unpackSave(packSave({ meta, state: a.save() })).state);
    for (const v of b.people.villagers) expect(b.people.tribes).toContain(v.tribe);
  });

  it('compresse la grille', async () => {
    const sim = new Simulation(3, 64);
    const raw = packSave({ meta, state: sim.save() });
    const gz = await encodeSave({ meta, state: sim.save() });
    expect(gz.length).toBeLessThan(raw.length / 2);
  });

  it('interrompt une genèse en cours', () => {
    const a = new Simulation(99, 32);
    const b = new Simulation(4, 32, true);
    expect(b.inGenesis).toBe(true);
    b.load(a.save());
    expect(b.inGenesis).toBe(false);
  });

  it('refuse de sauvegarder pendant la genèse', () => {
    expect(() => new Simulation(1, 32, true).save()).toThrow();
  });

  it('refuse une grille de taille différente', () => {
    const a = new Simulation(1, 32);
    const b = new Simulation(1, 48);
    expect(() => b.load(a.save())).toThrow(/32×32/);
  });

  it('rejette un fichier étranger ou tronqué', async () => {
    await expect(decodeSave(new TextEncoder().encode('bonjour'))).rejects.toBeInstanceOf(SaveError);
    const bytes = packSave({ meta, state: new Simulation(1, 32).save() });
    expect(() => unpackSave(bytes.subarray(0, bytes.length - 100))).toThrow(SaveError);
    const bad = bytes.slice();
    bad[4] = 9;
    expect(() => unpackSave(bad)).toThrow(/Version/);
  });
});
