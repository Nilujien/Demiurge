import { normalizeSeed } from '../core/seed';
import { SOILS, type SoilId } from '../sim/soils';
import type { WorldStats } from '../sim/simulation';
import { Overlay, type OverlayId } from '../render/renderer';
import { TOOLS, type ToolId } from '../tools/tools';

export interface HudState {
  tool: ToolId;
  soil: SoilId;
  overlay: OverlayId;
  brush: number;
  seaLevel: number;
  paused: boolean;
  /** Bulles d'activité au-dessus des habitants. */
  bubbles: boolean;
  /** Multiplicateur de la vitesse de simulation. */
  speed: Speed;
}

export const SPEEDS = [1, 2, 4] as const;
export type Speed = (typeof SPEEDS)[number];

/** Ce que l'infobulle dit d'un village survolé. */
export interface VillageInfo {
  id: number;
  population: number;
  capacity: number;
  houses: number;
  /** Maisons en chantier. */
  building: number;
  fields: number;
  wood: number;
  grain: number;
  /** Le grain ne suffira pas à nourrir tout le monde à la fin de l'année. */
  hungry: boolean;
}

export interface HudActions {
  rotate(quarterTurns: number): void;
  zoom(steps: number): void;
  regenerate(): void;
  seaLevel(level: number): void;
  pixelSize(px: number): void;
  /** Génère le monde d'une graine saisie. */
  seed(seed: number): void;
  undo(): void;
  redo(): void;
  share(): Promise<boolean>;
  save(): void;
  load(): void;
  exportFile(): void;
  importFile(bytes: Uint8Array): void;
}

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Élément #${id} absent de index.html`);
  return el as T;
};

function pixelIcon(rows: readonly string[]): string {
  let rects = '';
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === '#') rects += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
    }),
  );
  return `<svg viewBox="0 0 8 8" fill="currentColor" aria-hidden="true">${rects}</svg>`;
}

/** Panneaux DOM : outils, réglages, statistiques. L'état de référence vit ici et est lu par la boucle. */
export class Hud {
  readonly state: HudState = {
    tool: 'fertilize',
    soil: 1,
    overlay: Overlay.None,
    brush: 4,
    seaLevel: 0,
    paused: false,
    bubbles: true,
    speed: 1,
  };
  private seedValue = 0;
  private villageKey = '';

  constructor(private readonly actions: HudActions) {
    const grid = $('toolgrid');
    for (const t of TOOLS) {
      const b = document.createElement('button');
      b.className = 'tool';
      b.id = `tool-${t.id}`;
      b.dataset['tool'] = t.id;
      b.style.setProperty('--c', t.color);
      b.innerHTML = `${pixelIcon(t.icon)}<span>${t.label}</span><kbd>${t.key}</kbd>`;
      b.addEventListener('click', () => this.setTool(t.id));
      grid.appendChild(b);
    }
    const soils = $('soils');
    for (const s of SOILS) {
      const b = document.createElement('button');
      b.className = 'soil';
      b.id = `soil-${s.id}`;
      b.style.setProperty('--sw', s.swatch);
      b.innerHTML = `<i></i>${s.name}`;
      b.addEventListener('click', () => this.setSoil(s.id));
      soils.appendChild(b);
    }
    document
      .querySelectorAll<HTMLButtonElement>('#overlays .btn')
      .forEach((b) =>
        b.addEventListener('click', () => this.setOverlay(Number(b.dataset['ov']) as OverlayId)),
      );

    const brush = $<HTMLInputElement>('brush');
    brush.addEventListener('input', () => this.setBrush(Number(brush.value)));
    const sea = $<HTMLInputElement>('sea');
    sea.addEventListener('input', () => {
      this.state.seaLevel = Number(sea.value);
      $('seaOut').textContent = this.state.seaLevel.toFixed(1);
      actions.seaLevel(this.state.seaLevel);
    });
    const px = $<HTMLSelectElement>('px');
    px.addEventListener('change', () => actions.pixelSize(Number(px.value)));
    $('rotL').addEventListener('click', () => actions.rotate(-1));
    $('rotR').addEventListener('click', () => actions.rotate(1));
    $('zoomIn').addEventListener('click', () => actions.zoom(1));
    $('zoomOut').addEventListener('click', () => actions.zoom(-1));
    $('pause').addEventListener('click', () => this.togglePause());
    $('bubbles').addEventListener('click', () => this.toggleBubbles());
    $('regen').addEventListener('click', () => actions.regenerate());
    document
      .querySelectorAll<HTMLButtonElement>('#speeds [data-speed]')
      .forEach((b) => b.addEventListener('click', () => this.setSpeed(Number(b.dataset['speed']) as Speed)));
    $('undo').addEventListener('click', () => actions.undo());
    $('redo').addEventListener('click', () => actions.redo());
    const seed = $<HTMLInputElement>('seed');
    seed.addEventListener('change', () => {
      const v = normalizeSeed(seed.value);
      if (v === null || v === this.seedValue) seed.value = String(this.seedValue);
      else actions.seed(v);
    });
    seed.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') seed.blur();
    });
    $('save').addEventListener('click', () => actions.save());
    $('load').addEventListener('click', () => actions.load());
    $('export').addEventListener('click', () => actions.exportFile());
    const file = $<HTMLInputElement>('importFile');
    $('import').addEventListener('click', () => file.click());
    file.addEventListener('change', () => {
      const f = file.files?.[0];
      file.value = '';
      if (f) void f.arrayBuffer().then((b) => actions.importFile(new Uint8Array(b)));
    });
    const share = $('share');
    share.addEventListener('click', () => {
      void actions.share().then((ok) => {
        share.textContent = ok ? 'Copié !' : 'Échec';
        setTimeout(() => (share.textContent = 'Lien'), 1500);
      });
    });

    this.setTool(this.state.tool);
    this.setSoil(this.state.soil);
    this.setOverlay(this.state.overlay);
    this.setSpeed(this.state.speed);
  }

  /** Raccourcis clavier ; retourne true si la touche a été consommée. */
  handleKey(key: string): boolean {
    const tool = TOOLS.find((t) => t.key === key);
    if (tool) {
      this.setTool(tool.id);
      return true;
    }
    switch (key) {
      case 'q':
        this.actions.rotate(-1);
        return true;
      case 'e':
        this.actions.rotate(1);
        return true;
      case '[':
        this.setBrush(this.state.brush - 0.5);
        return true;
      case ']':
        this.setBrush(this.state.brush + 0.5);
        return true;
      case 'b':
        this.toggleBubbles();
        return true;
      case 'p':
        this.togglePause();
        return true;
      case 'v':
        this.setSpeed(SPEEDS[(SPEEDS.indexOf(this.state.speed) + 1) % SPEEDS.length]);
        return true;
      case 'h':
        this.setOverlay(((this.state.overlay + 1) % 3) as OverlayId);
        return true;
      case '+':
      case '=':
        this.actions.zoom(1);
        return true;
      case '-':
        this.actions.zoom(-1);
        return true;
      default:
        return false;
    }
  }

  setTool(id: ToolId): void {
    this.state.tool = id;
    document
      .querySelectorAll<HTMLButtonElement>('.tool')
      .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset['tool'] === id)));
    $('soilPick').hidden = id !== 'soil';
  }

  setSoil(id: SoilId): void {
    this.state.soil = id;
    SOILS.forEach((s) => $(`soil-${s.id}`).setAttribute('aria-pressed', String(s.id === id)));
  }

  setOverlay(v: OverlayId): void {
    this.state.overlay = v;
    document
      .querySelectorAll<HTMLButtonElement>('#overlays .btn')
      .forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset['ov']) === v)));
  }

  setBrush(v: number): void {
    this.state.brush = Math.min(14, Math.max(1, v));
    $<HTMLInputElement>('brush').value = String(this.state.brush);
    $('brushOut').textContent = String(this.state.brush);
  }

  toggleBubbles(): void {
    this.state.bubbles = !this.state.bubbles;
    $('bubbles').setAttribute('aria-pressed', String(this.state.bubbles));
  }

  togglePause(): void {
    this.state.paused = !this.state.paused;
    const b = $('pause');
    b.setAttribute('aria-pressed', String(this.state.paused));
    b.textContent = this.state.paused ? 'Reprendre' : 'Pause';
  }

  setSpeed(v: Speed): void {
    this.state.speed = v;
    document
      .querySelectorAll<HTMLButtonElement>('#speeds [data-speed]')
      .forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset['speed']) === v)));
  }

  setHistory(canUndo: boolean, canRedo: boolean): void {
    $<HTMLButtonElement>('undo').disabled = !canUndo;
    $<HTMLButtonElement>('redo').disabled = !canRedo;
  }

  setSeaLevel(level: number): void {
    this.state.seaLevel = level;
    $<HTMLInputElement>('sea').value = String(level);
    $('seaOut').textContent = level.toFixed(1);
  }

  /** La sauvegarde rapide existe : le bouton Charger devient utilisable. */
  setQuickSave(available: boolean): void {
    $<HTMLButtonElement>('load').disabled = !available;
  }

  setSaveStatus(text: string, error = false): void {
    const el = $('saveStatus');
    el.textContent = text;
    el.classList.toggle('error', error);
  }

  /** Affiche la graine du monde courant, sauf pendant que le joueur la modifie. */
  setSeed(seed: number): void {
    this.seedValue = seed;
    const el = $<HTMLInputElement>('seed');
    if (document.activeElement !== el) el.value = String(seed);
  }

  /** Infobulle d'un village survolé, près du pointeur (pixels CSS) ; null la masque. */
  showVillage(v: VillageInfo | null, x: number, y: number): void {
    const el = $('village');
    if (!v) {
      el.hidden = true;
      this.villageKey = '';
      return;
    }
    const fmt = (k: number): string => Math.floor(k).toLocaleString('fr-FR');
    const key = JSON.stringify(v);
    if (key !== this.villageKey) {
      this.villageKey = key;
      const houses = v.building ? `${v.houses} (+${v.building} en chantier)` : String(v.houses);
      el.innerHTML =
        `<b>${v.population < 8 ? 'Hameau' : 'Village'} n° ${v.id}</b>` +
        `<span><i>Habitants</i>${v.population} / ${v.capacity}</span>` +
        `<span><i>Maisons</i>${houses}</span>` +
        `<span><i>Champs</i>${v.fields}</span>` +
        `<span><i>Bois</i>${fmt(v.wood)}</span>` +
        `<span${v.hungry ? ' class="warn"' : ''}><i>Grain</i>${fmt(v.grain)}${v.hungry ? ' · disette' : ''}</span>`;
    }
    el.hidden = false;
    // À droite et sous le pointeur, ramenée dans la fenêtre.
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = Math.min(x + 16, window.innerWidth - w - 8);
    const top = Math.min(y + 16, window.innerHeight - h - 8);
    el.style.left = `${Math.max(8, left)}px`;
    el.style.top = `${Math.max(8, top)}px`;
  }

  showStats(s: WorldStats, time: string, fps: number): void {
    $('sTrees').textContent = s.trees.toLocaleString('fr-FR');
    $('sCover').textContent = `${Math.round(s.cover * 100)} %`;
    $('sPeople').textContent = s.population.toLocaleString('fr-FR');
    $('sFields').textContent = s.fields.toLocaleString('fr-FR');
    $('sTime').textContent = time;
    $('sFps').textContent = String(Math.round(fps));
  }
}
