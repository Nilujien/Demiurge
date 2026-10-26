/** Hachage entier 2D + canal → [0, 1). Stable : sert aussi aux variations visuelles par cellule. */
export function hash2(x: number, z: number, k: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ Math.imul(k | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Bruit de valeur lissé. */
export function valueNoise(x: number, z: number, k: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fz = z - zi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const a = hash2(xi, zi, k);
  const b = hash2(xi + 1, zi, k);
  const c = hash2(xi, zi + 1, k);
  const d = hash2(xi + 1, zi + 1, k);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Somme fractale normalisée dans [0, 1]. */
export function fbm(x: number, z: number, k: number, octaves = 5): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x * freq, z * freq, k + o * 17);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}
