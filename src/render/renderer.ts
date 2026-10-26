import { BASE, H_MAX, H_MIN, SNOW_LINE } from '../config';
import { clamp } from '../core/math';
import { hash2 } from '../core/noise';
import type { Simulation } from '../sim/simulation';
import { TREE_KINDS } from '../sim/soils';
import type { World } from '../sim/world';
import { FAR, type CameraFrame } from './camera';
import { ATTRIB, createPositionVAO, createProgram, createTexture, hexToRgb, type Program } from './gl';
import { buildTreeMeshes } from './meshes';
import { SKY, rampUniformData } from './palette';
import commonGlsl from './shaders/common.glsl?raw';
import postFrag from './shaders/post.frag?raw';
import postVert from './shaders/post.vert?raw';
import treeFrag from './shaders/tree.frag?raw';
import treeVert from './shaders/tree.vert?raw';
import worldFrag from './shaders/world.frag?raw';
import worldVert from './shaders/world.vert?raw';

const HEADER = '#version 300 es\n';
const vertex = (body: string): string => HEADER + body;
const fragment = (body: string): string => HEADER + commonGlsl + body;

/** Modes de la passe monde (contrat avec world.frag). */
const Mode = { Terrain: 0, Cliffs: 1, Water: 2, WaterWalls: 3 } as const;

export const Overlay = { None: 0, Moisture: 1, Fertility: 2 } as const;
export type OverlayId = (typeof Overlay)[keyof typeof Overlay];

export interface FrameParams {
  /** Temps d'animation quantifié (secondes). */
  animTime: number;
  brush: { x: number; z: number; radius: number; color: string } | null;
  overlay: OverlayId;
}

interface TreeBatch {
  vao: WebGLVertexArrayObject;
  instanceBuffer: WebGLBuffer;
  vertexCount: number;
  data: Float32Array;
  count: number;
}

/**
 * Rendu en deux passes :
 * 1. le monde (relief, tranches du diorama, eau, arbres) dans un framebuffer basse résolution ;
 * 2. agrandissement au plus proche voisin vers l'écran, avec contours par profondeur et ciel tramé.
 */
export class Renderer {
  readonly gl: WebGL2RenderingContext;
  lowWidth = 1;
  lowHeight = 1;
  /** Taille d'un pixel basse résolution en pixels physiques. */
  pixelScale = 3;
  dpr = 1;
  private pixelSize = 3;

  private readonly world: World;
  private readonly n: number;
  private readonly progWorld: Program;
  private readonly progTree: Program;
  private readonly progPost: Program;

  private readonly terrainPos: Float32Array;
  private readonly indexCount: number;
  private readonly terrain: { vao: WebGLVertexArrayObject; vbo: WebGLBuffer };
  private readonly walls: { vao: WebGLVertexArrayObject; vbo: WebGLBuffer };
  private readonly water: { vao: WebGLVertexArrayObject; vbo: WebGLBuffer };
  private readonly waterWalls: { vao: WebGLVertexArrayObject; vbo: WebGLBuffer };
  private readonly wallPos: Float32Array;
  private readonly waterWallPos: Float32Array;
  private readonly waterPos = new Float32Array(18);
  private wallCount = 0;
  private waterWallCount = 0;

  private readonly stateTex: WebGLTexture;
  private readonly hydroTex: WebGLTexture;
  private readonly stateBytes: Uint8Array;
  private readonly hydroBytes: Uint8Array;
  private readonly trees: TreeBatch[];

  private fbo: WebGLFramebuffer | null = null;
  private colorTex: WebGLTexture | null = null;
  private depthTex: WebGLTexture | null = null;
  private readonly emptyVAO: WebGLVertexArrayObject;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    world: World,
  ) {
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      depth: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 indisponible');
    this.gl = gl;
    this.world = world;
    this.n = world.n;
    const n = this.n;

    this.progWorld = createProgram(gl, vertex(worldVert), fragment(worldFrag), 'world');
    this.progTree = createProgram(gl, vertex(treeVert), fragment(treeFrag), 'tree');
    this.progPost = createProgram(gl, vertex(postVert), fragment(postFrag), 'post');
    const ramps = rampUniformData();
    for (const p of [this.progWorld, this.progTree, this.progPost]) {
      gl.useProgram(p.handle);
      gl.uniform3fv(p.uniform('u_ramp'), ramps);
    }

    // Relief : un sommet par cellule, diagonales alternées pour un aspect moins régulier.
    this.terrainPos = new Float32Array(world.cells * 3);
    const idx = new Uint32Array((n - 1) * (n - 1) * 6);
    let k = 0;
    for (let z = 0; z < n - 1; z++) {
      for (let x = 0; x < n - 1; x++) {
        const a = z * n + x;
        const b = a + 1;
        const c = a + n;
        const d = c + 1;
        idx.set((x + z) & 1 ? [a, c, b, b, c, d] : [a, c, d, a, d, b], k);
        k += 6;
      }
    }
    this.indexCount = idx.length;
    this.terrain = createPositionVAO(gl, this.terrainPos, gl.DYNAMIC_DRAW, idx);
    const wallMax = 4 * (n - 1) * 18;
    this.wallPos = new Float32Array(wallMax);
    this.waterWallPos = new Float32Array(wallMax);
    this.walls = createPositionVAO(gl, this.wallPos, gl.DYNAMIC_DRAW);
    this.waterWalls = createPositionVAO(gl, this.waterWallPos, gl.DYNAMIC_DRAW);
    this.water = createPositionVAO(gl, this.waterPos, gl.DYNAMIC_DRAW);

    // État par cellule. stateTex : sol, fertilité, herbe, altitude. hydroTex : humidité, cours d'eau, direction.
    this.stateTex = createTexture(gl, n, n, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
    this.hydroTex = createTexture(gl, n, n, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
    this.stateBytes = new Uint8Array(world.cells * 4);
    this.hydroBytes = new Uint8Array(world.cells * 4);

    this.trees = buildTreeMeshes().map((mesh) => this.createTreeBatch(mesh));
    if (this.trees.length !== TREE_KINDS) throw new Error('Un maillage par espèce d’arbre est attendu');

    const empty = gl.createVertexArray();
    if (!empty) throw new Error('Création de VAO impossible');
    this.emptyVAO = empty;
    this.resize();
  }

  setPixelSize(px: number): void {
    this.pixelSize = px;
    this.resize();
  }

  resize(): void {
    const gl = this.gl;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.floor(this.canvas.clientWidth * this.dpr));
    this.canvas.height = Math.max(1, Math.floor(this.canvas.clientHeight * this.dpr));
    this.pixelScale = Math.max(1, Math.round(this.pixelSize * this.dpr));
    this.lowWidth = Math.ceil(this.canvas.width / this.pixelScale);
    this.lowHeight = Math.ceil(this.canvas.height / this.pixelScale);

    if (this.fbo) gl.deleteFramebuffer(this.fbo);
    if (this.colorTex) gl.deleteTexture(this.colorTex);
    if (this.depthTex) gl.deleteTexture(this.depthTex);
    this.colorTex = createTexture(gl, this.lowWidth, this.lowHeight, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
    this.depthTex = createTexture(
      gl,
      this.lowWidth,
      this.lowHeight,
      gl.DEPTH_COMPONENT24,
      gl.DEPTH_COMPONENT,
      gl.UNSIGNED_INT,
    );
    this.fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.colorTex, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.depthTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** Convertit un point écran (pixels CSS) en coordonnées normalisées de la vue basse résolution. */
  screenToNdc(cssX: number, cssY: number): [number, number] {
    const lx = (cssX * this.dpr) / this.pixelScale;
    const ly = (this.canvas.height - cssY * this.dpr) / this.pixelScale;
    return [(lx / this.lowWidth) * 2 - 1, (ly / this.lowHeight) * 2 - 1];
  }

  /** Envoie au GPU ce que la simulation a modifié, puis remet ses drapeaux à zéro. */
  sync(sim: Simulation): void {
    const d = sim.dirty;
    if (d.heights) {
      this.uploadGeometry();
      d.state = true;
      d.trees = true;
      d.heights = false;
    }
    if (d.state) {
      this.uploadState();
      d.state = false;
    }
    if (d.trees) {
      this.uploadTrees();
      d.trees = false;
    }
  }

  render(cam: CameraFrame, p: FrameParams): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.lowWidth, this.lowHeight);
    gl.clearColor(0, 0, 0, 1);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);

    const w = this.progWorld;
    gl.useProgram(w.handle);
    gl.uniformMatrix4fv(w.uniform('u_vp'), false, cam.viewProj);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.stateTex);
    gl.uniform1i(w.uniform('u_state'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.hydroTex);
    gl.uniform1i(w.uniform('u_hydro'), 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(w.uniform('u_N'), this.n);
    gl.uniform1i(w.uniform('u_overlay'), p.overlay);
    gl.uniform1f(w.uniform('u_W'), this.world.seaLevel);
    gl.uniform1f(w.uniform('u_tq'), p.animTime);
    gl.uniform1f(w.uniform('u_ppu'), cam.pixelsPerUnit);
    gl.uniform1f(w.uniform('u_hmin'), H_MIN);
    gl.uniform1f(w.uniform('u_hmax'), H_MAX);
    gl.uniform1f(w.uniform('u_snow'), SNOW_LINE);
    const b = p.brush;
    gl.uniform4f(w.uniform('u_brush'), b?.x ?? 0, b?.z ?? 0, b?.radius ?? 0, b ? 1 : 0);
    gl.uniform3fv(w.uniform('u_ringCol'), hexToRgb(b?.color ?? '#ffffff'));

    gl.uniform1i(w.uniform('u_mode'), Mode.Terrain);
    gl.bindVertexArray(this.terrain.vao);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0);
    gl.uniform1i(w.uniform('u_mode'), Mode.Cliffs);
    gl.bindVertexArray(this.walls.vao);
    gl.drawArrays(gl.TRIANGLES, 0, this.wallCount);
    gl.uniform1i(w.uniform('u_mode'), Mode.Water);
    gl.bindVertexArray(this.water.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    if (this.waterWallCount) {
      gl.uniform1i(w.uniform('u_mode'), Mode.WaterWalls);
      gl.bindVertexArray(this.waterWalls.vao);
      gl.drawArrays(gl.TRIANGLES, 0, this.waterWallCount);
    }

    const t = this.progTree;
    gl.useProgram(t.handle);
    gl.uniformMatrix4fv(t.uniform('u_vp'), false, cam.viewProj);
    gl.uniform1f(t.uniform('u_tq'), p.animTime);
    for (const batch of this.trees) {
      if (!batch.count) continue;
      gl.bindVertexArray(batch.vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, batch.vertexCount, batch.count);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.disable(gl.DEPTH_TEST);
    const q = this.progPost;
    gl.useProgram(q.handle);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.colorTex);
    gl.uniform1i(q.uniform('u_col'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.depthTex);
    gl.uniform1i(q.uniform('u_dep'), 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(q.uniform('u_ps'), this.pixelScale);
    gl.uniform2i(q.uniform('u_low'), this.lowWidth, this.lowHeight);
    gl.uniform3fv(q.uniform('u_skyT'), hexToRgb(SKY.top));
    gl.uniform3fv(q.uniform('u_skyB'), hexToRgb(SKY.bottom));
    gl.uniform1f(q.uniform('u_thr'), 2.5 / (FAR - 1)); // écart de profondeur (unités monde) qui trace un contour
    gl.uniform1f(q.uniform('u_tq'), p.animTime);
    gl.bindVertexArray(this.emptyVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private createTreeBatch(mesh: Float32Array): TreeBatch {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    const meshBuffer = gl.createBuffer();
    const instanceBuffer = gl.createBuffer();
    if (!vao || !meshBuffer || !instanceBuffer) throw new Error('Création des tampons d’arbres impossible');
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, meshBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, mesh, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(ATTRIB.pos);
    gl.vertexAttribPointer(ATTRIB.pos, 3, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(ATTRIB.mat);
    gl.vertexAttribPointer(ATTRIB.mat, 1, gl.FLOAT, false, 16, 12);
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.world.cells * 20, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(ATTRIB.inst);
    gl.vertexAttribPointer(ATTRIB.inst, 4, gl.FLOAT, false, 20, 0);
    gl.vertexAttribDivisor(ATTRIB.inst, 1);
    gl.enableVertexAttribArray(ATTRIB.seed);
    gl.vertexAttribPointer(ATTRIB.seed, 1, gl.FLOAT, false, 20, 16);
    gl.vertexAttribDivisor(ATTRIB.seed, 1);
    gl.bindVertexArray(null);
    return {
      vao,
      instanceBuffer,
      vertexCount: mesh.length / 4,
      data: new Float32Array(this.world.cells * 5),
      count: 0,
    };
  }

  private uploadGeometry(): void {
    const gl = this.gl;
    const { n, height, seaLevel: sea } = this.world;
    for (let i = 0; i < this.world.cells; i++) {
      this.terrainPos[i * 3] = i % n;
      this.terrainPos[i * 3 + 1] = height[i];
      this.terrainPos[i * 3 + 2] = Math.floor(i / n);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.terrain.vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.terrainPos);

    // Tranches du diorama le long des 4 bords, et tranches d'eau là où la mer dépasse le relief.
    let k = 0;
    let kw = 0;
    const quad = (
      arr: Float32Array,
      at: number,
      ax: number,
      az: number,
      aTop: number,
      aBot: number,
      bx: number,
      bz: number,
      bTop: number,
      bBot: number,
    ): number => {
      arr.set([ax, aTop, az, bx, bTop, bz, bx, bBot, bz, ax, aTop, az, bx, bBot, bz, ax, aBot, az], at);
      return at + 18;
    };
    const edge = (ax: number, az: number, bx: number, bz: number): void => {
      const ha = height[az * n + ax];
      const hb = height[bz * n + bx];
      k = quad(this.wallPos, k, ax, az, ha, BASE, bx, bz, hb, BASE);
      if (ha < sea || hb < sea) {
        // léger recouvrement au-dessus du plan d'eau : évite les fissures de rasterisation
        kw = quad(
          this.waterWallPos,
          kw,
          ax,
          az,
          sea + 0.08,
          Math.min(ha, sea),
          bx,
          bz,
          sea + 0.08,
          Math.min(hb, sea),
        );
      }
    };
    for (let i = 0; i < n - 1; i++) {
      edge(i, 0, i + 1, 0);
      edge(i, n - 1, i + 1, n - 1);
      edge(0, i, 0, i + 1);
      edge(n - 1, i, n - 1, i + 1);
    }
    this.wallCount = k / 3;
    this.waterWallCount = kw / 3;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.walls.vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.wallPos.subarray(0, k));
    if (kw) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.waterWalls.vbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.waterWallPos.subarray(0, kw));
    }
    const m = n - 1;
    this.waterPos.set([0, sea, 0, m, sea, 0, m, sea, m, 0, sea, 0, m, sea, m, 0, sea, m]);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.water.vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.waterPos);
  }

  private uploadState(): void {
    const gl = this.gl;
    const w = this.world;
    const s = this.stateBytes;
    const h = this.hydroBytes;
    for (let i = 0; i < w.cells; i++) {
      const k = i * 4;
      s[k] = w.soil[i];
      s[k + 1] = w.fertility[i] * 255;
      s[k + 2] = w.grass[i] * 255;
      s[k + 3] = clamp((w.height[i] - H_MIN) / (H_MAX - H_MIN), 0, 1) * 255;
      h[k] = w.moisture[i] * 255;
      h[k + 1] = w.stream[i] * 255;
      h[k + 2] = w.flowDir[i] + 1;
      h[k + 3] = 0;
    }
    gl.bindTexture(gl.TEXTURE_2D, this.stateTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.n, this.n, gl.RGBA, gl.UNSIGNED_BYTE, s);
    gl.bindTexture(gl.TEXTURE_2D, this.hydroTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.n, this.n, gl.RGBA, gl.UNSIGNED_BYTE, h);
  }

  private uploadTrees(): void {
    const gl = this.gl;
    const w = this.world;
    const n = w.n;
    for (const t of this.trees) t.count = 0;
    for (let i = 0; i < w.cells; i++) {
      const g = w.tree[i];
      if (g <= 0) continue;
      const batch = this.trees[w.treeKind[i]];
      if (!batch) continue;
      const x = i % n;
      const z = Math.floor(i / n);
      const jx = x + (hash2(x, z, 3) - 0.5) * 0.5;
      const jz = z + (hash2(x, z, 5) - 0.5) * 0.5;
      const k = batch.count * 5;
      batch.data[k] = jx;
      batch.data[k + 1] = w.heightAt(jx, jz) - 0.08;
      batch.data[k + 2] = jz;
      batch.data[k + 3] = (0.3 + 0.7 * g) * (1.05 + 0.35 * hash2(x, z, 9));
      batch.data[k + 4] = hash2(x, z, 11);
      batch.count++;
    }
    for (const t of this.trees) {
      if (!t.count) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, t.instanceBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, t.data.subarray(0, t.count * 5));
    }
  }
}
