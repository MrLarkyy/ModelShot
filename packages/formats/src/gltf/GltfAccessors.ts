import { quoteValue } from '../bbmodel/quoteValue';
import type { GltfBuffers } from './GltfBuffers';
import { GltfError } from './GltfError';
import type { GltfLimits } from './GltfLoadOptions';
import {
  childPath,
  field,
  readIndex,
  readInteger,
  readList,
  readObject,
  readOptionalBoolean,
  readOptionalIndex,
  readOptionalInteger,
  readString,
  type JsonObject,
} from './gltfFields';

/** What an accessor is read as; each allows only the layouts glTF 2.0 allows for that attribute. */
export type AccessorUsage = 'POSITION' | 'NORMAL' | 'TEXCOORD' | 'INDICES';

const FLOAT = 5126;
const UNSIGNED_BYTE = 5121;
const UNSIGNED_SHORT = 5123;
const UNSIGNED_INT = 5125;
const COMPONENT_BYTES: Readonly<Record<number, number>> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const COMPONENTS: Readonly<Record<string, number>> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
};

const LAYOUTS: Readonly<Record<AccessorUsage, { type: string; components: readonly number[]; normalized: boolean }>> = {
  POSITION: { type: 'VEC3', components: [FLOAT], normalized: false },
  NORMAL: { type: 'VEC3', components: [FLOAT], normalized: false },
  TEXCOORD: { type: 'VEC2', components: [FLOAT, UNSIGNED_BYTE, UNSIGNED_SHORT], normalized: true },
  INDICES: { type: 'SCALAR', components: [UNSIGNED_BYTE, UNSIGNED_SHORT, UNSIGNED_INT], normalized: false },
};

/** A checked accessor: every byte it reads lies inside its buffer view, and the view inside its buffer. */
export interface AccessorInfo {
  readonly index: number;
  readonly path: string;
  readonly usage: AccessorUsage;
  readonly componentType: number;
  readonly components: number;
  readonly normalized: boolean;
  readonly count: number;
  /** Uses `sparse` storage, which the loader does not read. */
  readonly sparse: boolean;
  /** `null`: no buffer view, every value is 0. */
  readonly view: { readonly buffer: number; readonly offset: number; readonly stride: number } | null;
}

/**
 * The document's accessors and buffer views. `describe` validates layout and bounds from the JSON alone (declared
 * buffer lengths, no data read); the readers then decode through a `DataView`, little-endian and unaligned-safe. The
 * caller bounds `count` by the vertex and triangle limits before reading, since an accessor without a buffer view has
 * no bytes to bound it.
 */
export class GltfAccessors {
  private readonly accessors: readonly unknown[];
  private readonly views: readonly unknown[];

  constructor(
    json: JsonObject,
    private readonly buffers: GltfBuffers,
    limits: GltfLimits,
  ) {
    this.accessors = readList(json, 'accessors', '$', {
      max: limits.maxAccessors,
      code: 'TOO_MANY_ACCESSORS',
      what: 'accessors',
    });
    this.views = readList(json, 'bufferViews', '$', {
      max: limits.maxAccessors,
      code: 'TOO_MANY_ACCESSORS',
      what: 'buffer views',
    });
  }

  get count(): number {
    return this.accessors.length;
  }

  describe(index: number, usage: AccessorUsage): AccessorInfo {
    const path = childPath('$.accessors', index);
    const accessor = readObject(this.accessors[index], path);
    const componentType = readInteger(field(accessor, 'componentType'), childPath(path, 'componentType'), 5120, 5126);
    const componentBytes = COMPONENT_BYTES[componentType];
    if (componentBytes === undefined) {
      throw new GltfError('INVALID_FIELD', childPath(path, 'componentType'), `unknown component type ${componentType}`);
    }
    const type = readString(field(accessor, 'type'), childPath(path, 'type'), 8);
    const normalized = readOptionalBoolean(accessor, 'normalized', path, false);
    const layout = LAYOUTS[usage];
    const allowed =
      type === layout.type &&
      layout.components.includes(componentType) &&
      (componentType === FLOAT ? !normalized : usage === 'INDICES' ? !normalized : normalized);
    if (!allowed) {
      throw new GltfError(
        'INVALID_FIELD',
        path,
        `${quoteValue(type)} of component type ${componentType}${normalized ? ' (normalized)' : ''} cannot be ${usage}`,
      );
    }
    const components = COMPONENTS[type] ?? 1;
    const count = readInteger(field(accessor, 'count'), childPath(path, 'count'), 1, Number.MAX_SAFE_INTEGER);
    const sparse = field(accessor, 'sparse') !== undefined;
    const viewIndex = readOptionalIndex(accessor, 'bufferView', path, this.views.length);
    const byteOffset = readOptionalInteger(accessor, 'byteOffset', path, { min: 0, max: Number.MAX_SAFE_INTEGER }, 0);
    if (viewIndex === undefined) {
      return { index, path, usage, componentType, components, normalized, count, sparse, view: null };
    }
    const elementBytes = componentBytes * components;
    const view = this.describeView(viewIndex);
    const stride = view.stride ?? elementBytes;
    if (stride < elementBytes) {
      throw new GltfError('INVALID_FIELD', `$.bufferViews[${viewIndex}].byteStride`, `${stride} < ${elementBytes}`);
    }
    // In float64: exact for every value below 2^53, so a count times a stride beyond 2^32 cannot wrap around.
    const end = byteOffset + stride * (count - 1) + elementBytes;
    if (end > view.length) {
      throw new GltfError(
        'ACCESSOR_OUT_OF_BOUNDS',
        path,
        `reads ${end} bytes of buffer view ${viewIndex}, which has ${view.length}`,
      );
    }
    return {
      index,
      path,
      usage,
      componentType,
      components,
      normalized,
      count,
      sparse,
      view: { buffer: view.buffer, offset: view.offset + byteOffset, stride },
    };
  }

  private describeView(index: number): { buffer: number; offset: number; length: number; stride: number | undefined } {
    const path = childPath('$.bufferViews', index);
    const view = readObject(this.views[index], path);
    const buffer = readIndex(field(view, 'buffer'), childPath(path, 'buffer'), this.buffers.count);
    const offset = readOptionalInteger(view, 'byteOffset', path, { min: 0, max: Number.MAX_SAFE_INTEGER }, 0);
    const length = readInteger(field(view, 'byteLength'), childPath(path, 'byteLength'), 1, Number.MAX_SAFE_INTEGER);
    const strideValue = field(view, 'byteStride');
    const stride =
      strideValue === undefined ? undefined : readInteger(strideValue, childPath(path, 'byteStride'), 4, 252);
    if (stride !== undefined && stride % 4 !== 0) {
      throw new GltfError('INVALID_FIELD', childPath(path, 'byteStride'), `${stride} is not a multiple of 4`);
    }
    const bufferLength = this.buffers.byteLength(buffer);
    if (offset + length > bufferLength) {
      throw new GltfError(
        'ACCESSOR_OUT_OF_BOUNDS',
        path,
        `ends at byte ${offset + length} of a ${bufferLength}-byte buffer`,
      );
    }
    return { buffer, offset, length, stride };
  }

  /** A buffer view's bytes (for an embedded image); bounds checked like an accessor's. */
  viewBytes(index: number): Uint8Array {
    const view = this.describeView(index);
    return this.buffers.get(view.buffer).subarray(view.offset, view.offset + view.length);
  }

  get viewCount(): number {
    return this.views.length;
  }

  /**
   * `count × components` floats; normalized integers mapped to 0..1. POSITION and TEXCOORD values must be finite
   * (`NON_FINITE_DATA`); NORMAL values are returned as stored for the caller to repair.
   */
  readFloats(info: AccessorInfo): Float32Array {
    const out = new Float32Array(info.count * info.components);
    if (!info.view) return out;
    const { offset, stride } = info.view;
    const data = this.buffers.get(info.view.buffer);
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const bytes = COMPONENT_BYTES[info.componentType] ?? 4;
    for (let i = 0; i < info.count; i++) {
      for (let c = 0; c < info.components; c++) {
        const at = offset + i * stride + c * bytes;
        const value =
          info.componentType === FLOAT
            ? view.getFloat32(at, true)
            : info.componentType === UNSIGNED_BYTE
              ? view.getUint8(at) / 255
              : view.getUint16(at, true) / 65535;
        if (info.usage !== 'NORMAL' && !Number.isFinite(value)) {
          throw new GltfError('NON_FINITE_DATA', info.path, `element ${i} of ${info.usage} is not a finite number`);
        }
        out[i * info.components + c] = value;
      }
    }
    return out;
  }

  /** Indices, each checked against `vertexCount`. */
  readIndices(info: AccessorInfo, vertexCount: number): Uint32Array {
    const out = new Uint32Array(info.count);
    if (!info.view) return out;
    const { offset, stride } = info.view;
    const data = this.buffers.get(info.view.buffer);
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for (let i = 0; i < info.count; i++) {
      const at = offset + i * stride;
      const value =
        info.componentType === UNSIGNED_BYTE
          ? view.getUint8(at)
          : info.componentType === UNSIGNED_SHORT
            ? view.getUint16(at, true)
            : view.getUint32(at, true);
      if (value >= vertexCount) {
        throw new GltfError(
          'INDEX_OUT_OF_RANGE',
          info.path,
          `index ${value} at ${i}, the primitive has ${vertexCount} vertices`,
        );
      }
      out[i] = value;
    }
    return out;
  }
}
