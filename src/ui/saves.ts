import { decodeSave, encodeSave, SaveError, type SaveMeta } from '../sim/save';
import type { Simulation } from '../sim/simulation';
import type { Hud } from './hud';
import { downloadFile, readSlot, writeSlot, type Slot } from './storage';

/** Intervalle de la sauvegarde automatique. */
const AUTOSAVE_MS = 60_000;

export interface SaveContext {
  /** Graine du monde courant. */
  seed(): number;
  /** Une partie vient d'être chargée : l'historique, la graine affichée et l'URL doivent suivre. */
  loaded(meta: SaveMeta): void;
}

const clock = (t: number): string =>
  new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

function reason(err: unknown): string {
  if (err instanceof SaveError) return err.message;
  if (err instanceof DOMException && err.name === 'QuotaExceededError') return 'stockage du navigateur plein';
  return err instanceof Error ? err.message : String(err);
}

/** Sauvegardes : automatique et rapide dans IndexedDB, export et import de fichiers. */
export class Saves {
  /** Les opérations sont faites l'une après l'autre : une sauvegarde automatique n'en croise pas une autre. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly sim: Simulation,
    private readonly hud: Hud,
    private readonly ctx: SaveContext,
  ) {}

  /**
   * Au démarrage, reprend la partie sauvegardée automatiquement, sauf si l'URL demande un autre monde
   * (lien partagé). Lance ensuite la sauvegarde automatique.
   */
  start(urlSeed: number | null): void {
    this.run(async () => {
      this.hud.setQuickSave((await readSlot('quick')) !== null);
      const auto = await readSlot('auto');
      if (auto && (urlSeed === null || urlSeed === auto.seed)) {
        await this.apply(auto.bytes);
        this.hud.setSaveStatus(`Partie reprise (an ${this.sim.years})`);
      }
    }, 'Reprise impossible');
    setInterval(() => this.autosave(), AUTOSAVE_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.autosave();
    });
  }

  save(): void {
    this.run(async () => {
      await this.write('quick');
      this.hud.setQuickSave(true);
      this.hud.setSaveStatus(`Sauvegardé à ${clock(Date.now())} (an ${this.sim.years})`);
    }, 'Sauvegarde impossible');
  }

  load(): void {
    this.run(async () => {
      const quick = await readSlot('quick');
      if (!quick) throw new SaveError('aucune sauvegarde rapide');
      await this.apply(quick.bytes);
      this.hud.setSaveStatus(`Sauvegarde de ${clock(quick.savedAt)} reprise (an ${this.sim.years})`);
    }, 'Chargement impossible');
  }

  exportFile(): void {
    this.run(async () => {
      const { bytes } = await this.encode();
      downloadFile(bytes, `demiurge-graine-${this.ctx.seed()}-an-${this.sim.years}.demiurge`);
      this.hud.setSaveStatus('Fichier exporté');
    }, 'Export impossible');
  }

  importFile(bytes: Uint8Array): void {
    this.run(async () => {
      await this.apply(bytes);
      this.hud.setSaveStatus(`Partie importée (an ${this.sim.years})`);
    }, 'Import impossible');
  }

  private autosave(): void {
    if (this.sim.inGenesis) return;
    this.run(async () => {
      await this.write('auto');
      this.hud.setSaveStatus(`Sauvegarde automatique à ${clock(Date.now())}`);
    }, 'Sauvegarde automatique impossible');
  }

  private run(task: () => Promise<void>, failure: string): void {
    this.queue = this.queue.then(task).catch((err: unknown) => {
      console.error(err);
      this.hud.setSaveStatus(`${failure} : ${reason(err)}`, true);
    });
  }

  private async encode(): Promise<{ bytes: Uint8Array; meta: SaveMeta }> {
    if (this.sim.inGenesis) throw new SaveError('le monde est encore en genèse');
    // L'état est copié tout de suite ; seule la compression est asynchrone.
    const meta = { seed: this.ctx.seed(), savedAt: Date.now() };
    const state = this.sim.save();
    return { bytes: await encodeSave({ meta, state }), meta };
  }

  private async write(slot: Slot): Promise<void> {
    const { bytes, meta } = await this.encode();
    await writeSlot(slot, { ...meta, bytes });
  }

  /** Charge une sauvegarde ; en cas d'échec, le monde courant est rétabli tel quel. */
  private async apply(bytes: Uint8Array): Promise<void> {
    const file = await decodeSave(bytes);
    const backup = this.sim.inGenesis ? null : this.sim.save();
    try {
      this.sim.load(file.state);
    } catch (err) {
      if (backup) this.sim.load(backup);
      else this.sim.beginGenesis(this.ctx.seed());
      throw err instanceof SaveError ? err : new SaveError(`sauvegarde invalide (${reason(err)})`);
    }
    this.ctx.loaded(file.meta);
  }
}
