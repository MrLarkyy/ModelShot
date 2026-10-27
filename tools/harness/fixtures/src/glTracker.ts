export interface GlTracker {
  liveGlObjects: () => number;
  livePrograms: () => number;
  openBitmaps: () => number;
  /** Draw calls since the last call, split by whether the bound program is the denoiser guide (has `u_guideRays`). */
  drawCounts: () => { guide: number; other: number };
}

const GL_KINDS = ['Buffer', 'Texture', 'Framebuffer', 'Renderbuffer', 'VertexArray', 'Program', 'Shader'] as const;

type GlMethod = (this: WebGL2RenderingContext, ...args: unknown[]) => unknown;

/**
 * Counts WebGL objects created and not deleted, and ImageBitmaps created and not closed, on this page. Installed
 * before the renderer exists, so a leak shows as a count above 0 after `dispose()`.
 */
export function installGlTracker(): GlTracker {
  const live = new Set<unknown>();
  const programs = new Set<unknown>();
  const proto = WebGL2RenderingContext.prototype as unknown as Record<string, GlMethod>;
  for (const kind of GL_KINDS) {
    const create = proto[`create${kind}`];
    const remove = proto[`delete${kind}`];
    if (!create || !remove) throw new Error(`WebGL2 has no create/delete${kind}`);
    proto[`create${kind}`] = function (this: WebGL2RenderingContext, ...args: unknown[]): unknown {
      const object = create.apply(this, args);
      if (object) live.add(object);
      if (object && kind === 'Program') programs.add(object);
      return object;
    };
    proto[`delete${kind}`] = function (this: WebGL2RenderingContext, ...args: unknown[]): unknown {
      live.delete(args[0]);
      programs.delete(args[0]);
      return remove.apply(this, args);
    };
  }

  const guidePrograms = new Set<unknown>();
  let current: unknown = null;
  let counts = { guide: 0, other: 0 };
  const use = proto['useProgram'];
  const locate = proto['getUniformLocation'];
  const draw = proto['drawArrays'];
  if (!use || !locate || !draw) throw new Error('WebGL2 lacks useProgram, getUniformLocation or drawArrays');
  proto['useProgram'] = function (this: WebGL2RenderingContext, ...args: unknown[]): unknown {
    current = args[0];
    return use.apply(this, args);
  };
  proto['getUniformLocation'] = function (this: WebGL2RenderingContext, ...args: unknown[]): unknown {
    const location = locate.apply(this, args);
    if (location && args[1] === 'u_guideRays') guidePrograms.add(args[0]);
    return location;
  };
  proto['drawArrays'] = function (this: WebGL2RenderingContext, ...args: unknown[]): unknown {
    if (guidePrograms.has(current)) counts.guide++;
    else counts.other++;
    return draw.apply(this, args);
  };

  const bitmaps = new Set<ImageBitmap>();
  const createBitmap = window.createImageBitmap.bind(window) as (...args: unknown[]) => Promise<ImageBitmap>;
  const trackedCreate = async (...args: unknown[]): Promise<ImageBitmap> => {
    const bitmap = await createBitmap(...args);
    bitmaps.add(bitmap);
    return bitmap;
  };
  window.createImageBitmap = trackedCreate;
  const bitmapProto = ImageBitmap.prototype as unknown as { close: (this: ImageBitmap) => void };
  const close = bitmapProto.close;
  bitmapProto.close = function (this: ImageBitmap): void {
    bitmaps.delete(this);
    close.call(this);
  };

  return {
    liveGlObjects: () => live.size,
    livePrograms: () => programs.size,
    openBitmaps: () => bitmaps.size,
    drawCounts: () => {
      const result = counts;
      counts = { guide: 0, other: 0 };
      return result;
    },
  };
}
