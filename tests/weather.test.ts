import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { Weather } from '../src/sim/weather';

function flat(n = 32): World {
  const w = new World(n);
  w.height.fill(2);
  w.moisture.fill(0.1);
  return w;
}

describe('Weather', () => {
  it("l'eau versée forme un nuage sans mouiller le sol tout de suite", () => {
    const w = flat();
    const weather = new Weather(w);
    weather.addRain(16, 16, 4, 0.5);
    expect(weather.clouds).toHaveLength(1);
    expect(weather.clouds[0].water).toBeGreaterThan(0);
    expect(w.moisture[w.index(16, 16)]).toBeCloseTo(0.1);
  });

  it('un geste continu nourrit le même nuage', () => {
    const weather = new Weather(flat());
    for (let k = 0; k < 10; k++) weather.addRain(16 + k * 0.2, 16, 4, 0.05);
    expect(weather.clouds).toHaveLength(1);
  });

  it('le nuage pleut sur les cellules couvertes puis se dissipe', () => {
    const w = flat();
    const weather = new Weather(w);
    weather.addRain(16, 16, 4, 0.5);
    weather.step();
    expect(w.moisture[w.index(16, 16)]).toBeGreaterThan(0.1);
    expect(w.moisture[w.index(2, 2)]).toBeCloseTo(0.1);
    for (let t = 0; t < 200 && weather.clouds.length; t++) weather.step();
    expect(weather.clouds).toHaveLength(0);
  });

  it('les nuages dérivent avec le vent', () => {
    const weather = new Weather(flat());
    weather.addRain(16, 16, 3, 0.5);
    const x0 = weather.clouds[0].x;
    weather.step();
    expect(weather.clouds[0].x).toBeGreaterThan(x0);
  });
});
