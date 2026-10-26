import './ui/styles.css';
import { ANIM_FPS, SIM_HZ } from './config';
import { Rng } from './core/rng';
import { Input } from './input/input';
import { IsoCamera } from './render/camera';
import { Renderer } from './render/renderer';
import { raycastTerrain } from './sim/raycast';
import { soilDef } from './sim/soils';
import { Simulation } from './sim/simulation';
import { applyTool, toolDef } from './tools/tools';
import { Hud } from './ui/hud';

const INITIAL_SEED = 1789;
const FLOW_MIN_INTERVAL_MS = 250;
const MAX_TICKS_PER_FRAME = 3;
/** Temps de préhistoire simulé par image pendant la genèse : le monde se forme sous les yeux. */
const GENESIS_BUDGET_MS = 12;

function boot(): void {
  const canvas = document.getElementById('view');
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('#view doit être un <canvas>');

  const sim = new Simulation(INITIAL_SEED, undefined, true);
  let renderer: Renderer;
  try {
    renderer = new Renderer(canvas, sim);
  } catch (err) {
    console.error(err);
    const msg = document.getElementById('nogl');
    if (msg) msg.hidden = false;
    return;
  }

  const n = sim.world.n;
  const camera = new IsoCamera([(n - 1) / 2, 3, (n - 1) / 2], n);
  camera.fit(renderer.lowWidth);
  const toolRng = new Rng(INITIAL_SEED ^ 0x9e3779b9);

  const hud = new Hud({
    rotate: (q) => camera.rotate(q),
    zoom: (s) => camera.zoom(s),
    regenerate: () => sim.beginGenesis((Math.random() * 1e6) | 0),
    seaLevel: (level) => sim.setSeaLevel(level),
    pixelSize: (px) => renderer.setPixelSize(px),
  });

  let flattenTo = 0;
  let strokeStarted = false;
  const input = new Input(canvas, {
    pan: (dx, dy) =>
      camera.pan((dx * renderer.dpr) / renderer.pixelScale, (dy * renderer.dpr) / renderer.pixelScale),
    zoom: (s) => camera.zoom(s),
    strokeStart: () => (strokeStarted = true),
    key: (k) => hud.handleKey(k),
  });
  window.addEventListener('resize', () => renderer.resize());

  let last = performance.now();
  let simAccum = 0;
  let lastFlow = 0;
  let statAccum = 0;
  let frames = 0;

  const frame = (now: number): void => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const cam = camera.update(dt, renderer.lowWidth, renderer.lowHeight);
    const ui = hud.state;

    // Pinceau : rayon écran → relief
    let hit = null;
    if (input.brushVisible) {
      const [nx, ny] = renderer.screenToNdc(input.x, input.y);
      const ray = camera.ray(nx, ny);
      hit = raycastTerrain(sim.world, ray.origin, ray.dir);
    }
    if (input.mode === 'paint' && hit && !sim.inGenesis) {
      if (strokeStarted) {
        flattenTo = hit[1];
        strokeStarted = false;
      }
      applyTool(sim, ui.tool, {
        x: hit[0],
        z: hit[2],
        radius: ui.brush,
        dt,
        soil: ui.soil,
        flattenTo,
        random: () => toolRng.next(),
      });
    }

    // Genèse étalée sur plusieurs images, puis simulation à pas fixe, découplée du rendu
    if (sim.inGenesis) {
      sim.advanceGenesis(GENESIS_BUDGET_MS);
      simAccum = 0;
    } else if (!ui.paused) {
      simAccum += dt;
      let steps = 0;
      while (simAccum >= 1 / SIM_HZ && steps < MAX_TICKS_PER_FRAME) {
        sim.tick();
        simAccum -= 1 / SIM_HZ;
        steps++;
      }
      if (steps === MAX_TICKS_PER_FRAME) simAccum = 0; // onglet en arrière-plan : on ne rattrape pas
    }
    if (sim.flowDirty && now - lastFlow > FLOW_MIN_INTERVAL_MS) {
      sim.updateFlow();
      lastFlow = now;
    }

    renderer.sync(sim);
    const color = ui.tool === 'soil' ? soilDef(ui.soil).swatch : toolDef(ui.tool).color;
    renderer.render(cam, {
      animTime: Math.floor((now / 1000) * ANIM_FPS) / ANIM_FPS,
      time: now / 1000,
      simAlpha: Math.min(1, simAccum * SIM_HZ),
      brush: hit ? { x: hit[0], z: hit[2], radius: ui.brush, color } : null,
      overlay: ui.overlay,
      bubbles: ui.bubbles,
    });

    frames++;
    statAccum += dt;
    if (statAccum > 0.5) {
      const time = sim.inGenesis ? `genèse ${Math.floor(sim.genesisProgress * 100)} %` : `an ${sim.years}`;
      hud.showStats(sim.stats(), time, frames / statAccum);
      frames = 0;
      statAccum = 0;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

boot();
