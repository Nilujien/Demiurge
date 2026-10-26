import { H_MAX } from '../config';
import { clamp } from '../core/math';
import type { World } from './world';

export const RAIN = {
  /** Eau apportée au nuage par seconde de pinceau, par cellule couverte. */
  feed: 1.6,
  /** Humidité déposée par pas au centre du nuage. */
  rate: 0.11,
  /** Dérive des nuages par pas (cellules) : un vent faible et constant. */
  windX: 0.025,
  windZ: 0.012,
  /** Altitude des nuages au-dessus du relief qu'ils survolent. */
  ceiling: 6,
  maxClouds: 24,
  maxRadius: 14,
} as const;

/** Nuage de pluie : il reçoit l'eau du démiurge et la restitue au sol en averse. */
export interface Cloud {
  /** Identifiant stable : sert de graine aux gouttes dessinées. */
  readonly id: number;
  x: number;
  z: number;
  radius: number;
  /** Eau restant à précipiter (somme d'humidité sur les cellules). */
  water: number;
  /** Altitude de la base du nuage. */
  alt: number;
}

/** Météo : nuages de pluie déplacés par le vent. L'humidité du démiurge arrive au sol par eux. */
export class Weather {
  readonly clouds: Cloud[] = [];
  private nextId = 1;

  constructor(private readonly world: World) {}

  reset(): void {
    this.clouds.length = 0;
  }

  /** Charge en eau un nuage au-dessus de (x, z), en le créant au besoin. */
  addRain(x: number, z: number, radius: number, dt: number): void {
    const r = clamp(radius, 1, RAIN.maxRadius);
    let cloud: Cloud | undefined;
    let best = Infinity;
    for (const c of this.clouds) {
      const d = Math.hypot(c.x - x, c.z - z);
      if (d < Math.max(r, c.radius) * 0.75 && d < best) {
        best = d;
        cloud = c;
      }
    }
    if (!cloud) {
      if (this.clouds.length >= RAIN.maxClouds) return;
      cloud = { id: this.nextId++, x, z, radius: r, water: 0, alt: this.ceilingAt(x, z, r) };
      this.clouds.push(cloud);
    }
    // Le nuage suit le pinceau et prend sa taille.
    const k = Math.min(1, dt * 6);
    cloud.x += (x - cloud.x) * k;
    cloud.z += (z - cloud.z) * k;
    cloud.radius += (r - cloud.radius) * k;
    cloud.water += RAIN.feed * Math.PI * r * r * dt;
  }

  /** Un pas : chaque nuage dérive, pleut sur les cellules qu'il couvre et s'épuise. */
  step(): void {
    const w = this.world;
    const { n, moisture, height } = w;
    for (let c = this.clouds.length - 1; c >= 0; c--) {
      const cloud = this.clouds[c];
      cloud.x += RAIN.windX;
      cloud.z += RAIN.windZ;
      cloud.alt += (this.ceilingAt(cloud.x, cloud.z, cloud.radius) - cloud.alt) * 0.1;
      const r = cloud.radius;
      const x0 = Math.max(0, Math.floor(cloud.x - r));
      const x1 = Math.min(n - 1, Math.ceil(cloud.x + r));
      const z0 = Math.max(0, Math.floor(cloud.z - r));
      const z1 = Math.min(n - 1, Math.ceil(cloud.z + r));
      // Averse plus faible quand le nuage est presque vide.
      const strength = Math.min(1, cloud.water / (Math.PI * r * r * RAIN.rate * 2));
      let rained = 0;
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          const d = Math.hypot(x - cloud.x, z - cloud.z);
          if (d > r) continue;
          const k = 1 - (d / r) ** 2;
          const drop = RAIN.rate * k * strength;
          rained += drop;
          const i = z * n + x;
          if (height[i] >= w.seaLevel) moisture[i] = Math.min(1, moisture[i] + drop);
        }
      }
      cloud.water -= rained;
      const outside = x1 < x0 || z1 < z0;
      if (cloud.water <= 0.01 || outside) this.clouds.splice(c, 1);
    }
  }

  /** Base des nuages : un peu au-dessus du point le plus haut qu'ils couvrent. */
  private ceilingAt(x: number, z: number, r: number): number {
    const w = this.world;
    let top = w.seaLevel;
    for (const [dx, dz] of [
      [0, 0],
      [r, 0],
      [-r, 0],
      [0, r],
      [0, -r],
    ]) {
      const h = w.heightAt(clamp(x + dx * 0.7, 0, w.n - 1), clamp(z + dz * 0.7, 0, w.n - 1));
      if (h > top) top = h;
    }
    return Math.min(top + RAIN.ceiling, H_MAX + 4);
  }
}
