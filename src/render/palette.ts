import { hexToRgb } from './gl';

/**
 * Palette du monde : 12 rampes de 4 teintes, de la plus sombre à la plus claire.
 * L'ordre des rampes est un contrat avec les shaders (identifiants de matériau).
 */
export const Material = {
  Sand: 0,
  Humus: 1,
  Clay: 2,
  Rock: 3,
  Grass: 4,
  DryGrass: 5,
  Snow: 6,
  Trunk: 7,
  Broadleaf: 8,
  Conifer: 9,
  Water: 10,
  Accents: 11,
} as const;

export const RAMPS: readonly (readonly [string, string, string, string])[] = [
  ['#8a6f4a', '#b8955e', '#d9bb7b', '#efdba0'], // sable
  ['#3e2a22', '#5c3d2c', '#7d5636', '#9a7046'], // humus
  ['#6b3a2e', '#94503a', '#b86b47', '#d48a5a'], // argile
  ['#3b3d4a', '#565a68', '#767b88', '#9ba0a8'], // roche
  ['#1f4a32', '#2f6b3a', '#4c8f3c', '#7cb44a'], // herbe
  ['#4f5a2a', '#6f7a34', '#93984a', '#b8b45f'], // herbe sèche
  ['#8794b4', '#a9b6d0', '#cfd8e8', '#f2f5fa'], // neige
  ['#2c1d18', '#4a2f22', '#6b4630', '#8a5e3c'], // tronc
  ['#173d2b', '#235a32', '#367a3a', '#5c9e44'], // feuillus
  ['#0f2e2c', '#17443a', '#226044', '#3a7d50'], // conifères
  ['#22477a', '#2c64a0', '#3d8cbd', '#82c9e0'], // eau
  ['#e8f4f0', '#b6f07a', '#ffe9a8', '#ffffff'], // écume, pousses, accents
];

export const SKY = { top: '#15142a', bottom: '#3a3566' } as const;

export function rampUniformData(): Float32Array {
  return new Float32Array(RAMPS.flat().flatMap(hexToRgb));
}
