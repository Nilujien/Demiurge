/**
 * Générateur pseudo-aléatoire déterministe (mulberry32).
 * Toute la simulation passe par lui : une même graine redonne exactement le même monde,
 * ce qui rend les tests reproductibles et permettra rejeu et sauvegardes compactes.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0 || 1;
  }

  /** État interne, pour les sauvegardes : `restore(save())` reprend exactement la même suite. */
  save(): number {
    return this.state;
  }

  restore(state: number): void {
    this.state = state | 0 || 1;
  }

  /** Flottant uniforme dans [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}
