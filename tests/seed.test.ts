import { describe, expect, it } from 'vitest';
import { normalizeSeed, parseSeed, randomSeed, SEED_MAX, seedHash } from '../src/core/seed';

describe('graine dans l’URL', () => {
  it('lit la graine du fragment', () => {
    expect(parseSeed('#seed=1789')).toBe(1789);
    expect(parseSeed('#zoom=2&seed=42')).toBe(42);
    expect(parseSeed(seedHash(123456))).toBe(123456);
  });

  it('ignore un fragment absent ou invalide', () => {
    expect(parseSeed('')).toBeNull();
    expect(parseSeed('#seed=abc')).toBeNull();
    expect(parseSeed('#seed=12x')).toBeNull();
    expect(parseSeed('#seed=1234567890')).toBeNull();
    expect(parseSeed('#myseed=4')).toBeNull();
  });

  it('ramène une saisie libre à une graine valide', () => {
    expect(normalizeSeed(' 77 ')).toBe(77);
    expect(normalizeSeed('-5')).toBe(0);
    expect(normalizeSeed('1e12')).toBe(SEED_MAX);
    expect(normalizeSeed('')).toBeNull();
    expect(normalizeSeed('pomme')).toBeNull();
  });

  it('tire des graines dans les bornes', () => {
    for (let k = 0; k < 100; k++) {
      const s = randomSeed();
      expect(Number.isInteger(s) && s >= 0 && s <= SEED_MAX).toBe(true);
    }
  });
});
