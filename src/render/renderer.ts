import { BASE, H_MAX, H_MIN, SNOW_LINE } from '../config';
import { clamp } from '../core/math';
import { hash2 } from '../core/noise';
import { ACTIVITIES, activityOf, Activity, Carry, PEOPLE, type ActivityId } from '../sim/people';
import type { Simulation } from '../sim/simulation';
import { TREE_KINDS } from '../sim/soils';
import { RAIN } from '../sim/weather';
import type { World } from '../sim/world';
import { FAR, type CameraFrame } from './camera';
import { ATTRIB, createPositionVAO, createProgram, createTexture, hexToRgb, type Program } from './gl';
import { BUBBLE_H, BUBBLE_W, buildBubbleAtlas } from './icons';
import { buildPropMeshes, buildTreeMeshes, CHIMNEY, TREE_VARIANTS } from './meshes';
import { SKY, rampUniformData } from './palette';
import bubbleFrag from './shaders/bubble.frag?raw';
import bubbleVert from './shaders/bubble.vert?raw';
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
  /** Temps continu (secondes) : chute des gouttes de pluie. */
  time: number;
  /** Fraction écoulée du pas de simulation en cours [0, 1] : interpolation des déplacements. */
  simAlpha: number;
  brush: { x: number; z: number; radius: number; color: string } | null;
  overlay: OverlayId;
  /** Bulles d'activité au-dessus des habitants. */
  bubbles: boolean;
}

/** Gouttes de pluie dessinées au plus, tous nuages confondus. */
const MAX_DROPS = 3000;
/** Hauteur minimale d'un habitant à l'écran (pixels basse résolution). */
const VILLAGER_MIN_PX = 3;
const VILLAGER_HEIGHT = 0.7;
const MAX_HOUSES = 1024;
const HOUSE_SCALE = 1.25;
/** Bouffées de fumée par cheminée, durée de leur ascension (s) et hauteur atteinte (unités monde). */
const SMOKE_PUFFS = 8;
const SMOKE_LIFE = 3.2;
const SMOKE_RISE = 2.6;
/** Trame des bouffées selon leur âge : la fumée se dissipe en montant. */
const SMOKE_DITHER = [0.2, 0.45, 0.7] as const;
/** Zoom minimal (pixels par unité) pour afficher les bulles : en deçà, elles masqueraient le village. */
const BUBBLE_MIN_PPU = 4;
/** Durée du petit saut d'une bulle quand l'activité change (secondes). */
const BUBBLE_HOP = 0.3;

/**
 * Un maillage dessiné en instanciation ; par instance : position (x, y, z), échelle, graine.
 * `first` : rang de la première instance quand plusieurs maillages partagent un même tampon.
 */
interface InstanceBatch {
  vao: WebGLVertexArrayObject;
  instanceBuffer: WebGLBuffer;
  vertexCount: number;
  data: Float32Array;
  count: number;
  first: number;
  shared: boolean;
}

/** Tampon d'instances commun à plusieurs maillages, rangé maillage par maillage. */
interface SharedInstances {
  buffer: WebGLBuffer;
  data: Float32Array;
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

  private readonly sim: Simulation;
  private readonly world: World;
  private readonly n: number;
  private readonly progWorld: Program;
  private readonly progTree: Program;
  private readonly progPost: Program;
  private readonly progBubble: Program;
  private readonly bubbleAtlas: WebGLTexture;
  private readonly bubbles: InstanceBatch;
  /** Dernière activité affichée par habitant, et depuis quand : fait sauter la bulle au changement. */
  private bubbleSeen = new Map<number, { activity: ActivityId; since: number }>();

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
  /** Un maillage par espèce et variante (espèce × TREE_VARIANTS + variante), un seul tampon d'instances. */
  private readonly trees: InstanceBatch[];
  private readonly treeInstances: SharedInstances;
  private readonly treeOrder: Uint8Array;
  /** Habitants les mains vides, chargés de bois, chargés de grain (indexés par `Carry`). */
  private readonly villagers: InstanceBatch[];
  private readonly houses: InstanceBatch;
  private readonly clouds: InstanceBatch;
  /** Fumée des cheminées, une série par tranche d'âge (voir SMOKE_DITHER). */
  private readonly smoke: InstanceBatch[];
  private readonly drops: InstanceBatch;

  private fbo: WebGLFramebuffer | null = null;
  private colorTex: WebGLTexture | null = null;
  private depthTex: WebGLTexture | null = null;
  private readonly emptyVAO: WebGLVertexArrayObject;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    sim: Simulation,
  ) {
    const world = sim.world;
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      depth: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 indisponible');
    this.gl = gl;
    this.sim = sim;
    this.world = world;
    this.n = world.n;
    const n = this.n;

    this.progWorld = createProgram(gl, vertex(worldVert), fragment(worldFrag), 'world');
    this.progTree = createProgram(gl, vertex(treeVert), fragment(treeFrag), 'tree');
    this.progPost = createProgram(gl, vertex(postVert), fragment(postFrag), 'post');
    this.progBubble = createProgram(gl, vertex(bubbleVert), fragment(bubbleFrag), 'bubble');
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

    const treeBuffer = gl.createBuffer();
    if (!treeBuffer) throw new Error('Création du tampon d’arbres impossible');
    gl.bindBuffer(gl.ARRAY_BUFFER, treeBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, world.cells * 20, gl.DYNAMIC_DRAW);
    this.treeInstances = { buffer: treeBuffer, data: new Float32Array(world.cells * 5) };
    this.trees = buildTreeMeshes().map((mesh) => this.createBatch(mesh, 0, this.treeInstances));
    if (this.trees.length !== TREE_KINDS * TREE_VARIANTS) {
      throw new Error('TREE_VARIANTS maillages par espèce d’arbre sont attendus');
    }
    this.treeOrder = new Uint8Array(world.cells);
    const props = buildPropMeshes();
    this.villagers = [props.villager, props.villagerWood, props.villagerGrain].map((mesh) =>
      this.createBatch(mesh, PEOPLE.maxVillagers),
    );
    this.houses = this.createBatch(props.house, MAX_HOUSES);
    this.clouds = this.createBatch(props.cloud, RAIN.maxClouds);
    this.smoke = SMOKE_DITHER.map(() => this.createBatch(props.smoke, MAX_HOUSES * SMOKE_PUFFS));
    this.drops = this.createBatch(props.drop, MAX_DROPS);
    const quad = new Float32Array([0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 1, 0, 0]);
    this.bubbles = this.createBatch(quad, PEOPLE.maxVillagers);
    const atlasW = BUBBLE_W * ACTIVITIES;
    this.bubbleAtlas = createTexture(gl, atlasW, BUBBLE_H, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, atlasW, BUBBLE_H, gl.RGBA, gl.UNSIGNED_BYTE, buildBubbleAtlas());

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
    gl.uniform1f(t.uniform('u_dither'), 0);
    this.uploadActors(cam.pixelsPerUnit, p);
    gl.uniform1f(t.uniform('u_stretch'), 1);
    for (const batch of this.trees) this.draw(batch);
    gl.uniform1f(t.uniform('u_stretch'), 0);
    for (const batch of [...this.villagers, this.houses]) this.draw(batch);
    // Pluie et nuages : sans écriture de profondeur, pour ne pas tracer de contours dans la trame.
    gl.depthMask(false);
    this.draw(this.drops);
    SMOKE_DITHER.forEach((d, k) => {
      gl.uniform1f(t.uniform('u_dither'), d);
      this.draw(this.smoke[k]);
    });
    gl.uniform1f(t.uniform('u_dither'), 0.45);
    this.draw(this.clouds);
    gl.depthMask(true);

    if (p.bubbles && cam.pixelsPerUnit >= BUBBLE_MIN_PPU && this.bubbles.count) {
      // Bulles au premier plan : pas de test de profondeur, profondeur minimale écrite (aucun contour interne).
      const bq = this.progBubble;
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(bq.handle);
      gl.uniformMatrix4fv(bq.uniform('u_vp'), false, cam.viewProj);
      gl.uniform2f(bq.uniform('u_low'), this.lowWidth, this.lowHeight);
      gl.uniform2f(bq.uniform('u_cell'), BUBBLE_W, BUBBLE_H);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.bubbleAtlas);
      gl.uniform1i(bq.uniform('u_atlas'), 0);
      this.draw(this.bubbles);
      gl.enable(gl.DEPTH_TEST);
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

  private draw(batch: InstanceBatch): void {
    if (!batch.count) return;
    const gl = this.gl;
    gl.bindVertexArray(batch.vao);
    if (batch.shared) {
      // WebGL2 n'a pas de « base instance » : on décale les attributs d'instance dans le tampon commun.
      gl.bindBuffer(gl.ARRAY_BUFFER, batch.instanceBuffer);
      gl.vertexAttribPointer(ATTRIB.inst, 4, gl.FLOAT, false, 20, batch.first * 20);
      gl.vertexAttribPointer(ATTRIB.seed, 1, gl.FLOAT, false, 20, batch.first * 20 + 16);
    }
    gl.drawArraysInstanced(gl.TRIANGLES, 0, batch.vertexCount, batch.count);
  }

  private createBatch(mesh: Float32Array, capacity: number, shared?: SharedInstances): InstanceBatch {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    const meshBuffer = gl.createBuffer();
    const instanceBuffer = shared ? shared.buffer : gl.createBuffer();
    if (!vao || !meshBuffer || !instanceBuffer) throw new Error('Création des tampons d’arbres impossible');
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, meshBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, mesh, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(ATTRIB.pos);
    gl.vertexAttribPointer(ATTRIB.pos, 3, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(ATTRIB.mat);
    gl.vertexAttribPointer(ATTRIB.mat, 1, gl.FLOAT, false, 16, 12);
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
    if (!shared) gl.bufferData(gl.ARRAY_BUFFER, capacity * 20, gl.DYNAMIC_DRAW);
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
      data: shared ? shared.data : new Float32Array(capacity * 5),
      count: 0,
      first: 0,
      shared: !!shared,
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
      // Champ : 0 = aucun, 1 = labouré sans céréales, puis croissance des céréales jusqu'à 255 (mûres).
      h[k + 3] = w.field[i] ? 1 + Math.min(1, w.crop[i]) * 254 : 0;
    }
    gl.bindTexture(gl.TEXTURE_2D, this.stateTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.n, this.n, gl.RGBA, gl.UNSIGNED_BYTE, s);
    gl.bindTexture(gl.TEXTURE_2D, this.hydroTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.n, this.n, gl.RGBA, gl.UNSIGNED_BYTE, h);
  }

  /** Tri par comptage des arbres par maillage, puis un seul envoi du tampon commun. */
  private uploadTrees(): void {
    const w = this.world;
    const n = w.n;
    const order = this.treeOrder;
    for (const t of this.trees) t.count = 0;
    for (let i = 0; i < w.cells; i++) {
      if (w.tree[i] <= 0) continue;
      const k =
        w.treeKind[i] * TREE_VARIANTS + Math.floor(hash2(i % n, Math.floor(i / n), 17) * TREE_VARIANTS);
      order[i] = k;
      this.trees[k].count++;
    }
    let first = 0;
    for (const t of this.trees) {
      t.first = first;
      first += t.count;
      t.count = 0;
    }
    const data = this.treeInstances.data;
    for (let i = 0; i < w.cells; i++) {
      const g = w.tree[i];
      if (g <= 0) continue;
      const batch = this.trees[order[i]];
      const x = i % n;
      const z = Math.floor(i / n);
      const jx = x + (hash2(x, z, 3) - 0.5) * 0.5;
      const jz = z + (hash2(x, z, 5) - 0.5) * 0.5;
      const o = (batch.first + batch.count) * 5;
      data[o] = jx;
      data[o + 1] = w.heightAt(jx, jz) - 0.08;
      data[o + 2] = jz;
      data[o + 3] = (0.3 + 0.7 * g) * (1.05 + 0.35 * hash2(x, z, 9));
      data[o + 4] = hash2(x, z, 11);
      batch.count++;
    }
    if (!first) return;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.treeInstances.buffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data.subarray(0, first * 5));
  }

  private upload(batch: InstanceBatch): void {
    if (!batch.count) return;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, batch.instanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, batch.data.subarray(0, batch.count * 5));
  }

  private push(batch: InstanceBatch, x: number, y: number, z: number, scale: number, seed: number): void {
    if ((batch.count + 1) * 5 > batch.data.length) return;
    const k = batch.count * 5;
    batch.data[k] = x;
    batch.data[k + 1] = y;
    batch.data[k + 2] = z;
    batch.data[k + 3] = scale;
    batch.data[k + 4] = seed;
    batch.count++;
  }

  /** Bouffées sans état : chacune monte, grossit et dérive avec le vent selon le temps. */
  private pushSmoke(cell: number, x: number, z: number, cx: number, cz: number, time: number): void {
    const base = this.world.height[cell] - 0.05;
    const sx = x + cx * HOUSE_SCALE;
    const sz = z + cz * HOUSE_SCALE;
    const sy = base + CHIMNEY.top * HOUSE_SCALE;
    const wind = Math.hypot(RAIN.windX, RAIN.windZ);
    for (let k = 0; k < SMOKE_PUFFS; k++) {
      const age = (time / SMOKE_LIFE + k / SMOKE_PUFFS + hash2(cell, k, 61) * 0.1) % 1;
      const drift = age * age * 1.4;
      const wobble = Math.sin(time * 2 + k * 1.7 + cell) * 0.08 * age;
      const band = Math.min(SMOKE_DITHER.length - 1, Math.floor(age * SMOKE_DITHER.length));
      this.push(
        this.smoke[band],
        sx + (RAIN.windX / wind) * drift + wobble,
        sy + age * SMOKE_RISE,
        sz + (RAIN.windZ / wind) * drift - wobble,
        0.13 + 0.3 * age,
        hash2(cell, k, 67),
      );
    }
  }

  /** Habitants, maisons, nuages et gouttes : reconstruits à chaque image (positions interpolées). */
  private uploadActors(ppu: number, p: FrameParams): void {
    const w = this.world;
    const { people, weather } = this.sim;
    const a = p.simAlpha;

    for (const b of this.villagers) b.count = 0;
    this.bubbles.count = 0;
    const seen2 = new Map<number, { activity: ActivityId; since: number }>();
    const vs = Math.max(1, VILLAGER_MIN_PX / (VILLAGER_HEIGHT * ppu));
    for (const v of people.villagers) {
      const x = v.px + (v.x - v.px) * a;
      const z = v.pz + (v.z - v.pz) * a;
      const moving = v.x !== v.px || v.z !== v.pz;
      // Petit rebond à la marche et au travail (coups de hache, de houe).
      const bob = moving || v.working ? Math.abs(Math.sin(p.time * 11 + v.id)) * 0.06 * vs : 0;
      const seed = (((-v.heading / (Math.PI * 2)) % 1) + 1) % 1;
      const batch = this.villagers[v.carry] ?? this.villagers[Carry.None];
      const ground = w.heightAt(x, z);
      this.push(batch, x, ground + bob, z, vs, seed);

      const activity = activityOf(v);
      if (activity === Activity.None) continue;
      const seen = this.bubbleSeen.get(v.id);
      const since = seen && seen.activity === activity ? seen.since : p.time;
      seen2.set(v.id, { activity, since });
      const hop = p.time - since < BUBBLE_HOP ? 2 : 0;
      this.push(this.bubbles, x, ground + (VILLAGER_HEIGHT + 0.15) * vs, z, activity, hop);
    }
    this.bubbleSeen = seen2;
    for (const b of this.villagers) this.upload(b);
    this.upload(this.bubbles);

    this.houses.count = 0;
    for (const s of this.smoke) s.count = 0;
    // Rotation des maisons (graine 0.125 = un huitième de tour), comme dans tree.vert.
    const ang = 0.125 * Math.PI * 2;
    const chimneyX = Math.cos(ang) * CHIMNEY.x + Math.sin(ang) * CHIMNEY.z;
    const chimneyZ = -Math.sin(ang) * CHIMNEY.x + Math.cos(ang) * CHIMNEY.z;
    for (const tribe of people.tribes) {
      for (const h of tribe.houses) {
        const x = h.cell % w.n;
        const z = Math.floor(h.cell / w.n);
        // Un feu brûle dans les maisons achevées tant que le village a du bois.
        if (h.progress >= 1 && tribe.wood > 0) this.pushSmoke(h.cell, x, z, chimneyX, chimneyZ, p.time);
        // Les chantiers sortent de terre au fil de la construction.
        this.push(
          this.houses,
          x,
          w.height[h.cell] - 0.05,
          z,
          HOUSE_SCALE * (0.25 + 0.75 * h.progress),
          0.125,
        );
      }
    }
    this.upload(this.houses);
    for (const s of this.smoke) this.upload(s);

    this.clouds.count = 0;
    this.drops.count = 0;
    const ds = Math.max(1, 1 / (0.1 * ppu));
    for (const c of weather.clouds) {
      this.push(this.clouds, c.x, c.alt, c.z, c.radius * 0.75, hash2(c.id, 0, 41));
      const area = Math.PI * c.radius * c.radius;
      const strength = Math.min(1, c.water / (area * RAIN.rate * 2));
      const count = Math.min(240, Math.ceil(area * 1.2 * strength));
      for (let j = 0; j < count; j++) {
        const rr = c.radius * Math.sqrt(hash2(c.id, j, 43));
        const ang = hash2(c.id, j, 47) * Math.PI * 2;
        const x = c.x + Math.cos(ang) * rr;
        const z = c.z + Math.sin(ang) * rr;
        const ground = Math.max(w.heightAt(x, z), w.seaLevel);
        if (!Number.isFinite(ground) || ground >= c.alt) continue;
        const fall = c.alt - ground;
        const phase = (p.time * (9 / fall) + hash2(c.id, j, 53)) % 1;
        this.push(this.drops, x, c.alt - phase * fall, z, ds, hash2(c.id, j, 59));
      }
    }
    this.upload(this.clouds);
    this.upload(this.drops);
  }
}
