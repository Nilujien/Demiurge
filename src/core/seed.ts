/** Graine d'un monde, partageable dans l'URL sous la forme `#seed=1789`. */

export const SEED_MAX = 999_999_999;

/** Lit la graine d'un fragment d'URL ; null si absente ou invalide. */
export function parseSeed(hash: string): number | null {
  const m = /(?:^#|[#&])seed=(\d{1,9})(?:&|$)/.exec(hash);
  return m ? Number(m[1]) : null;
}

/** Ramène une saisie libre à une graine valide ; null si ce n'est pas un nombre. */
export function normalizeSeed(value: string): number | null {
  const v = Math.floor(Number(value.trim()));
  if (!value.trim() || !Number.isFinite(v)) return null;
  return Math.min(SEED_MAX, Math.max(0, v));
}

export function seedHash(seed: number): string {
  return `#seed=${seed}`;
}

export function randomSeed(): number {
  return Math.floor(Math.random() * (SEED_MAX + 1));
}
