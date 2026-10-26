import { clamp, cross, dot, mat4Mul, normalize, type Vec3 } from '../core/math';

/** Élévation de la caméra : 30° donne des losanges 2:1, le standard du pixel art isométrique. */
export const PITCH = (30 * Math.PI) / 180;
const DIST = 260;
export const FAR = DIST * 2 + 40;
const NEAR = 1;

/** Niveaux de zoom en pixels basse résolution par unité monde. */
export const ZOOM_LEVELS = [1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 16] as const;

export interface CameraFrame {
  viewProj: Float32Array;
  eye: Vec3;
  forward: Vec3;
  right: Vec3;
  up: Vec3;
  halfWidth: number;
  halfHeight: number;
  pixelsPerUnit: number;
}

/** Caméra orthographique isométrique : rotation par quarts de tour, zoom par paliers. */
export class IsoCamera {
  target: Vec3;
  rotation = 0;
  zoomIndex = 3;
  private yaw = Math.PI / 4;
  private frame: CameraFrame | null = null;

  constructor(
    target: Vec3,
    private readonly worldSize: number,
  ) {
    this.target = [...target];
  }

  get current(): CameraFrame {
    if (!this.frame) throw new Error('IsoCamera.update() doit être appelé avant usage');
    return this.frame;
  }

  /** Choisit le zoom qui fait tenir toute l'île à l'écran. */
  fit(lowWidth: number): void {
    let best = 0;
    ZOOM_LEVELS.forEach((ppu, i) => {
      if (ppu <= lowWidth / (this.worldSize * 1.33)) best = i;
    });
    this.zoomIndex = best;
  }

  rotate(quarterTurns: number): void {
    this.rotation += quarterTurns;
  }

  zoom(steps: number): void {
    this.zoomIndex = clamp(this.zoomIndex + steps, 0, ZOOM_LEVELS.length - 1);
  }

  /** Déplacement sur le sol, en pixels basse résolution (le contenu suit le pointeur). */
  pan(dxLow: number, dyLow: number): void {
    const { right, forward, pixelsPerUnit } = this.current;
    const fh = normalize([forward[0], 0, forward[2]]);
    const s = Math.sin(PITCH);
    const max = this.worldSize - 1;
    this.target[0] = clamp(
      this.target[0] - (right[0] * dxLow) / pixelsPerUnit + (fh[0] * dyLow) / (pixelsPerUnit * s),
      0,
      max,
    );
    this.target[2] = clamp(
      this.target[2] - (right[2] * dxLow) / pixelsPerUnit + (fh[2] * dyLow) / (pixelsPerUnit * s),
      0,
      max,
    );
  }

  update(dt: number, lowWidth: number, lowHeight: number): CameraFrame {
    const targetYaw = Math.PI / 4 + (this.rotation * Math.PI) / 2;
    this.yaw += (targetYaw - this.yaw) * Math.min(1, dt * 12);
    if (Math.abs(targetYaw - this.yaw) < 1e-3) this.yaw = targetYaw;

    const cp = Math.cos(PITCH);
    const back: Vec3 = [cp * Math.sin(this.yaw), Math.sin(PITCH), cp * Math.cos(this.yaw)];
    const f: Vec3 = [-back[0], -back[1], -back[2]];
    const r = normalize(cross(f, [0, 1, 0]));
    const u = cross(r, f);
    const ppu = ZOOM_LEVELS[this.zoomIndex] ?? 3;

    // Accroche la cible à la grille des pixels basse résolution : supprime le grouillement en déplacement.
    const step = 1 / ppu;
    const r0 = dot(this.target, r);
    const u0 = dot(this.target, u);
    const dr = Math.round(r0 / step) * step - r0;
    const du = Math.round(u0 / step) * step - u0;
    const t: Vec3 = [
      this.target[0] + r[0] * dr + u[0] * du,
      this.target[1] + r[1] * dr + u[1] * du,
      this.target[2] + r[2] * dr + u[2] * du,
    ];
    const e: Vec3 = [t[0] + back[0] * DIST, t[1] + back[1] * DIST, t[2] + back[2] * DIST];

    const view = new Float32Array([
      r[0],
      u[0],
      -f[0],
      0,
      r[1],
      u[1],
      -f[1],
      0,
      r[2],
      u[2],
      -f[2],
      0,
      -dot(r, e),
      -dot(u, e),
      dot(f, e),
      1,
    ]);
    const hw = lowWidth / 2 / ppu;
    const hh = lowHeight / 2 / ppu;
    const proj = new Float32Array([
      1 / hw,
      0,
      0,
      0,
      0,
      1 / hh,
      0,
      0,
      0,
      0,
      -2 / (FAR - NEAR),
      0,
      0,
      0,
      -(FAR + NEAR) / (FAR - NEAR),
      1,
    ]);

    this.frame = {
      viewProj: mat4Mul(proj, view),
      eye: e,
      forward: f,
      right: r,
      up: u,
      halfWidth: hw,
      halfHeight: hh,
      pixelsPerUnit: ppu,
    };
    return this.frame;
  }

  /** Rayon correspondant à un point écran en coordonnées normalisées [-1, 1]. */
  ray(ndcX: number, ndcY: number): { origin: Vec3; dir: Vec3 } {
    const { eye, right, up, forward, halfWidth, halfHeight } = this.current;
    const ox = ndcX * halfWidth;
    const oy = ndcY * halfHeight;
    return {
      origin: [
        eye[0] + right[0] * ox + up[0] * oy,
        eye[1] + right[1] * ox + up[1] * oy,
        eye[2] + right[2] * ox + up[2] * oy,
      ],
      dir: forward,
    };
  }
}
