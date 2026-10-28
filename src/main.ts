import './ui/styles.css';
import { ANIM_FPS, SIM_HZ } from './config';
import { Rng } from './core/rng';
import { parseSeed, randomSeed, seedHash } from './core/seed';
import { Input } from './input/input';
import { IsoCamera } from './render/camera';
import { Renderer } from './render/renderer';
import { raycastTerrain } from './sim/raycast';
import { soilDef } from './sim/soils';
import { Simulation } from './sim/simulation';
import { PEOPLE } from './sim/people';
import { StrokeHistory } from './tools/history';
import { applyTool, toolDef } from './tools/tools';
import { Hud } from './ui/hud';
import { Saves } from './ui/saves';

const INITIAL_SEED = 1789;
const FLOW_MIN_INTERVAL_MS = 250;
const MAX_TICKS_PER_FRAME = 3;
/** Temps de préhistoire simulé par image pendant la genèse : le monde se forme sous les yeux. */
const GENESIS_BUDGET_MS = 12;
/** Distance (cellules) entre le pointeur et un foyer ou une maison pour afficher l'infobulle du village. */
const VILLAGE_HOVER_RADIUS = 3;

function boot(): void {
  const canvas = document.getElementById('view');
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('#view doit être un <canvas>');

  const urlSeed = parseSeed(location.hash);
  let seed = urlSeed ?? INITIAL_SEED;
  const sim = new Simulation(seed, undefined, true);
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
  const toolRng = new Rng(seed ^ 0x9e3779b9);
  const strokes = new StrokeHistory(sim.world);

  const refreshHistory = (): void => hud.setHistory(strokes.canUndo, strokes.canRedo);
  const undo = (): void => {
    if (strokes.undo(sim)) refreshHistory();
  };
  const redo = (): void => {
    if (strokes.redo(sim)) refreshHistory();
  };
  /** Nouveau monde : la graine est inscrite dans l'URL pour qu'on puisse le retrouver ou le partager. */
  const startWorld = (s: number): void => {
    seed = s;
    sim.beginGenesis(s);
    strokes.clear();
    refreshHistory();
    hud.setSeed(s);
    history.replaceState(null, '', seedHash(s));
  };

  const hud = new Hud({
    rotate: (q) => camera.rotate(q),
    zoom: (s) => camera.zoom(s),
    regenerate: () => startWorld(randomSeed()),
    seed: (s) => startWorld(s),
    seaLevel: (level) => sim.setSeaLevel(level),
    pixelSize: (px) => renderer.setPixelSize(px),
    undo,
    redo,
    share: async () => {
      try {
        await navigator.clipboard.writeText(location.href);
        return true;
      } catch {
        return false;
      }
    },
    save: () => saves.save(),
    load: () => saves.load(),
    exportFile: () => saves.exportFile(),
    importFile: (bytes) => saves.importFile(bytes),
  });
  const saves = new Saves(sim, hud, {
    seed: () => seed,
    loaded: (meta) => {
      seed = meta.seed;
      strokes.clear();
      refreshHistory();
      hud.setSeed(seed);
      hud.setSeaLevel(sim.world.seaLevel);
      history.replaceState(null, '', seedHash(seed));
    },
  });
  hud.setSeed(seed);
  history.replaceState(null, '', seedHash(seed));
  window.addEventListener('hashchange', () => {
    const s = parseSeed(location.hash);
    if (s !== null && s !== seed) startWorld(s);
  });

  let flattenTo = 0;
  let strokeStarted = false;
  const input = new Input(canvas, {
    pan: (dx, dy) =>
      camera.pan((dx * renderer.dpr) / renderer.pixelScale, (dy * renderer.dpr) / renderer.pixelScale),
    zoom: (s) => camera.zoom(s),
    strokeStart: () => (strokeStarted = true),
    key: (k) => hud.handleKey(k),
    undo,
    redo,
    save: () => saves.save(),
  });
  saves.start(urlSeed);
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
      if (strokeStarted || strokes.recording !== ui.tool) {
        // Un changement d'outil en plein geste ouvre une nouvelle entrée d'historique.
        strokes.begin(ui.tool);
        refreshHistory();
      }
      if (strokeStarted) {
        flattenTo = hit[1];
        strokeStarted = false;
      }
      applyTool(
        sim,
        ui.tool,
        {
          x: hit[0],
          z: hit[2],
          radius: ui.brush,
          dt,
          soil: ui.soil,
          flattenTo,
          random: () => toolRng.next(),
        },
        strokes,
      );
    } else if (input.mode !== 'paint' && strokes.recording) {
      strokes.end();
      refreshHistory();
    }

    // Infobulle du village survolé
    const tribe =
      input.mode === 'idle' && hit && !sim.inGenesis
        ? sim.people.tribeNear(hit[0], hit[2], VILLAGE_HOVER_RADIUS)
        : null;
    hud.showVillage(
      tribe && {
        id: tribe.id,
        population: tribe.population,
        capacity: sim.people.capacity(tribe),
        houses: tribe.houses.filter((h) => h.progress >= 1).length,
        building: tribe.houses.filter((h) => h.progress < 1).length,
        fields: tribe.fields.length,
        wood: tribe.wood,
        grain: tribe.grain,
        hungry: tribe.grain < tribe.population * PEOPLE.grainPerYear,
      },
      input.x,
      input.y,
    );

    // Genèse étalée sur plusieurs images, puis simulation à pas fixe, découplée du rendu
    if (sim.inGenesis) {
      sim.advanceGenesis(GENESIS_BUDGET_MS);
      simAccum = 0;
    } else if (!ui.paused) {
      simAccum += dt * ui.speed;
      const maxSteps = MAX_TICKS_PER_FRAME * ui.speed;
      let steps = 0;
      while (simAccum >= 1 / SIM_HZ && steps < maxSteps) {
        sim.tick();
        simAccum -= 1 / SIM_HZ;
        steps++;
      }
      if (steps === maxSteps) simAccum = 0; // onglet en arrière-plan : on ne rattrape pas
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
