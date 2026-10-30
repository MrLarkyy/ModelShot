import { LOOK_PRESETS } from '@modelshot/looks';
import { MAX_FOV_DEG, MAX_PITCH_DEG, MIN_FOV_DEG, MIN_PITCH_DEG, type OrbitState } from '@modelshot/renderer-rt';
import type { SceneTextureFilter } from '@modelshot/scene';
import { CLIP_FORMAT_CHOICES, EXPORT_KINDS, type ExportSettings } from '../export/ExportSettings';
import { findHandoffViolation } from '../handoff/findHandoffViolation';
import type { PlayerArmsChoice } from '../intake/LoadMessages';
import type { RenderSettingsValues } from '../render/RenderSettings';
import { APP_STATE_VERSION, type ModelState, type SessionState } from './AppState';

const MAX_INDEX = 100_000;
const MAX_HIDDEN = 100_000;
/** Textures whose filter is remembered. */
export const MAX_TEXTURE_FILTERS = 4096;
const MODEL_KEY = /^[0-9a-f]{64}$/;

// Own data properties only: a getter or an inherited value never runs or counts.
function own(record: object, key: string): unknown {
  return Object.getOwnPropertyDescriptor(record, key)?.value;
}

function isRecord(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function number(value: unknown, lo: number, hi: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= lo && value <= hi ? value : null;
}

function integer(value: unknown, lo: number, hi: number): number | null {
  const n = number(value, lo, hi);
  return n !== null && Number.isInteger(n) ? n : null;
}

function indices(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length > MAX_HIDDEN) return null;
  const list: unknown[] = Array.from(value as unknown[]);
  const out: number[] = [];
  for (const entry of list) {
    const index = integer(entry, 0, MAX_INDEX);
    if (index === null) return null;
    out.push(index);
  }
  return out;
}

function readTextureFilters(value: unknown): SceneTextureFilter[] | null {
  if (!Array.isArray(value) || value.length > MAX_TEXTURE_FILTERS) return null;
  const list: unknown[] = Array.from(value as unknown[]);
  const out: SceneTextureFilter[] = [];
  for (const entry of list) {
    if (entry !== 'nearest' && entry !== 'linear') return null;
    out.push(entry);
  }
  return out;
}

function readCamera(value: unknown): OrbitState | null {
  if (!isRecord(value)) return null;
  const yawDeg = number(own(value, 'yawDeg'), -1e6, 1e6);
  const pitchDeg = number(own(value, 'pitchDeg'), MIN_PITCH_DEG, MAX_PITCH_DEG);
  const fovYDeg = number(own(value, 'fovYDeg'), MIN_FOV_DEG, MAX_FOV_DEG);
  const projection = own(value, 'projection');
  const distance = number(own(value, 'distance'), 1e-6, 1000);
  const orthoHeight = number(own(value, 'orthoHeight'), 1e-6, 1000);
  const target = own(value, 'target');
  if (yawDeg === null || pitchDeg === null || fovYDeg === null || distance === null || orthoHeight === null) {
    return null;
  }
  if (projection !== 'perspective' && projection !== 'orthographic') return null;
  if (!Array.isArray(target) || target.length !== 3) return null;
  const x = number(target[0], -1000, 1000);
  const y = number(target[1], -1000, 1000);
  const z = number(target[2], -1000, 1000);
  if (x === null || y === null || z === null) return null;
  return { yawDeg, pitchDeg, fovYDeg, projection, distance, orthoHeight, target: [x, y, z] };
}

function readRender(value: unknown): RenderSettingsValues | null {
  if (!isRecord(value)) return null;
  const samples = integer(own(value, 'samples'), 1, 65536);
  const supersample = integer(own(value, 'supersample'), 1, 4);
  const denoise = own(value, 'denoise');
  if (samples === null || supersample === null || typeof denoise !== 'boolean') return null;
  return { samples, supersample, denoise };
}

function readExport(value: unknown): ExportSettings | null {
  if (!isRecord(value)) return null;
  const kind = EXPORT_KINDS.find((candidate) => candidate === own(value, 'kind'));
  const clipFormat = CLIP_FORMAT_CHOICES.find((candidate) => candidate === own(value, 'clipFormat'));
  const width = integer(own(value, 'width'), 1, 4096);
  const height = integer(own(value, 'height'), 1, 4096);
  const samples = integer(own(value, 'samples'), 1, 65536);
  const supersample = integer(own(value, 'supersample'), 1, 4);
  const fps = integer(own(value, 'fps'), 1, 60);
  const frames = integer(own(value, 'frames'), 2, 1200);
  const denoise = own(value, 'denoise');
  const transparent = own(value, 'transparent');
  if (!kind || !clipFormat || width === null || height === null) return null;
  if (samples === null || supersample === null || fps === null || frames === null) return null;
  if (typeof denoise !== 'boolean' || typeof transparent !== 'boolean') return null;
  return { kind, clipFormat, width, height, samples, supersample, denoise, transparent, fps, frames };
}

/** The stored session record, or null when it is not exactly what `saveSession` writes. Never throws. */
export function readSession(value: unknown): SessionState | null {
  try {
    if (!isRecord(value) || own(value, 'v') !== APP_STATE_VERSION) return null;
    const modelKey = own(value, 'modelKey');
    const savedAt = number(own(value, 'savedAt'), 0, Number.MAX_SAFE_INTEGER);
    const stored = own(value, 'files');
    if (typeof modelKey !== 'string' || !MODEL_KEY.test(modelKey) || savedAt === null || !Array.isArray(stored)) {
      return null;
    }
    const files: unknown[] = Array.from(stored as unknown[]);
    if (!files.every((entry): entry is File => entry instanceof File)) return null;
    if (findHandoffViolation(files)) return null;
    return { v: APP_STATE_VERSION, files, modelKey, savedAt };
  } catch {
    return null;
  }
}

/** The stored view of one model, or null when anything in it is not valid (the model then opens with defaults). */
export function readModelState(value: unknown): ModelState | null {
  try {
    if (!isRecord(value) || own(value, 'v') !== APP_STATE_VERSION) return null;
    const camera = readCamera(own(value, 'camera'));
    const render = readRender(own(value, 'render'));
    const look = own(value, 'look');
    const hiddenNodes = indices(own(value, 'hiddenNodes'));
    const hiddenMeshes = indices(own(value, 'hiddenMeshes'));
    const savedAt = number(own(value, 'savedAt'), 0, Number.MAX_SAFE_INTEGER);
    if (!camera || !render || !hiddenNodes || !hiddenMeshes || savedAt === null) return null;
    if (typeof look !== 'string' || !Object.hasOwn(LOOK_PRESETS, look)) return null;
    const armsValue = own(value, 'arms');
    const arms: PlayerArmsChoice | undefined = armsValue === 'classic' || armsValue === 'slim' ? armsValue : undefined;
    const textureFilters = readTextureFilters(own(value, 'textureFilters'));
    const exportSettings = readExport(own(value, 'export'));
    return {
      v: APP_STATE_VERSION,
      camera,
      look,
      hiddenNodes,
      hiddenMeshes,
      ...(textureFilters ? { textureFilters } : {}),
      ...(arms ? { arms } : {}),
      render,
      ...(exportSettings ? { export: exportSettings } : {}),
      savedAt,
    };
  } catch {
    return null;
  }
}
