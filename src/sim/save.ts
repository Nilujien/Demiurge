import { WORLD_LAYERS, type LayerArray, type SimulationSave, type WorldLayer } from './simulation';

/**
 * Fichier de sauvegarde : un en-tête binaire, un JSON (état des habitants, des nuages, compteurs),
 * puis les calques de la grille bruts, le tout compressé en gzip.
 *
 *   « DMRG » | version (u32) | longueur du JSON (u32) | JSON | calques alignés sur 4 octets
 */
export const SAVE_VERSION = 1;
const MAGIC = 'DMRG';
const HEADER = 12;

/** Ce que la sauvegarde dit d'elle-même, en plus de l'état de la simulation. */
export interface SaveMeta {
  /** Graine du monde d'origine. */
  seed: number;
  /** Date de la sauvegarde (ms depuis l'époque Unix). */
  savedAt: number;
}

export interface SaveFile {
  meta: SaveMeta;
  state: SimulationSave;
}

type ArrayKind = 'f32' | 'u8' | 'i8';

interface LayerEntry {
  name: WorldLayer;
  kind: ArrayKind;
  offset: number;
  length: number;
}

interface Body extends SaveMeta, Omit<SimulationSave, 'layers'> {
  format: typeof MAGIC;
  version: number;
  layers: LayerEntry[];
}

/** Échec de lecture d'une sauvegarde : fichier étranger, corrompu ou d'une version inconnue. */
export class SaveError extends Error {}

const kindOf = (a: LayerArray): ArrayKind =>
  a instanceof Float32Array ? 'f32' : a instanceof Int8Array ? 'i8' : 'u8';

function view(kind: ArrayKind, buf: ArrayBuffer, offset: number, length: number): LayerArray {
  // Copie : le tampon décompressé n'est pas conservé.
  if (kind === 'f32') return new Float32Array(buf.slice(offset, offset + length * 4));
  if (kind === 'i8') return new Int8Array(buf.slice(offset, offset + length));
  return new Uint8Array(buf.slice(offset, offset + length));
}

const align4 = (k: number): number => (k + 3) & ~3;

/** Sérialise sans compresser. */
export function packSave(file: SaveFile): Uint8Array {
  const { layers, ...rest } = file.state;
  const entries: LayerEntry[] = [];
  let size = 0;
  for (const name of WORLD_LAYERS) {
    const a = layers[name];
    entries.push({ name, kind: kindOf(a), offset: size, length: a.length });
    size = align4(size + a.byteLength);
  }
  const body: Body = { format: MAGIC, version: SAVE_VERSION, ...file.meta, ...rest, layers: entries };
  const json = new TextEncoder().encode(JSON.stringify(body));
  const start = align4(HEADER + json.length);
  const out = new Uint8Array(start + size);
  const dv = new DataView(out.buffer);
  for (let k = 0; k < 4; k++) out[k] = MAGIC.charCodeAt(k);
  dv.setUint32(4, SAVE_VERSION, true);
  dv.setUint32(8, json.length, true);
  out.set(json, HEADER);
  for (const e of entries) {
    const a = layers[e.name];
    out.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), start + e.offset);
  }
  return out;
}

export function unpackSave(bytes: Uint8Array): SaveFile {
  if (bytes.length < HEADER || String.fromCharCode(...bytes.subarray(0, 4)) !== MAGIC) {
    throw new SaveError("Ce fichier n'est pas une sauvegarde de Demiurge");
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = dv.getUint32(4, true);
  if (version !== SAVE_VERSION) throw new SaveError(`Version de sauvegarde inconnue (${version})`);
  const jsonLength = dv.getUint32(8, true);
  if (HEADER + jsonLength > bytes.length) throw new SaveError('Sauvegarde tronquée');
  let body: Body;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes.subarray(HEADER, HEADER + jsonLength))) as Body;
  } catch {
    throw new SaveError('Sauvegarde illisible');
  }
  if (body.format !== MAGIC || !Array.isArray(body.layers) || !body.people || !body.weather) {
    throw new SaveError('Sauvegarde incomplète');
  }
  const start = align4(HEADER + jsonLength);
  const buf = bytes.buffer.slice(
    bytes.byteOffset + start,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const cells = body.n * body.n;
  const layers: Partial<Record<WorldLayer, LayerArray>> = {};
  for (const name of WORLD_LAYERS) {
    const e = body.layers.find((l) => l.name === name);
    const width = e?.kind === 'f32' ? 4 : 1;
    if (!e || e.length !== cells || e.offset < 0 || e.offset + e.length * width > buf.byteLength) {
      throw new SaveError(`Sauvegarde : calque ${name} absent ou tronqué`);
    }
    layers[name] = view(e.kind, buf, e.offset, e.length);
  }
  return {
    meta: { seed: body.seed, savedAt: body.savedAt },
    state: {
      n: body.n,
      ticks: body.ticks,
      rng: body.rng,
      flowDirty: body.flowDirty,
      seaLevel: body.seaLevel,
      layers: layers as SimulationSave['layers'],
      weather: body.weather,
      people: body.people,
    },
  };
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** Sauvegarde compressée, prête à écrire dans IndexedDB ou dans un fichier. */
export function encodeSave(file: SaveFile): Promise<Uint8Array> {
  return pipe(packSave(file), new CompressionStream('gzip'));
}

export async function decodeSave(bytes: Uint8Array): Promise<SaveFile> {
  let raw: Uint8Array;
  try {
    raw = await pipe(bytes, new DecompressionStream('gzip'));
  } catch {
    throw new SaveError("Ce fichier n'est pas une sauvegarde de Demiurge");
  }
  return unpackSave(raw);
}
