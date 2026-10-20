export interface GlTracker {
  liveGlObjects: () => number;
  openBitmaps: () => number;
}

const GL_KINDS = ['Buffer', 'Texture', 'Framebuffer', 'Renderbuffer', 'VertexArray', 'Program', 'Shader'] as const;

type GlMethod = (this: WebGL2RenderingContext, ...args: unknown[]) => unknown;

/**
 * Counts WebGL objects created and not deleted, and ImageBitmaps created and not closed, on this page. Installed
 * before the renderer exists, so a leak shows as a count above 0 after `dispose()`.
 */
export function installGlTracker(): GlTracker {
  const live = new Set<unknown>();
  const proto = WebGL2RenderingContext.prototype as unknown as Record<string, GlMethod>;
  for (const kind of GL_KINDS) {
    const create = proto[`create${kind}`];
    const remove = proto[`delete${kind}`];
    if (!create || !remove) throw new Error(`WebGL2 has no create/delete${kind}`);
    proto[`create${kind}`] = function (this: WebGL2RenderingContext, ...args: unknown[]): unknown {
      const object = create.apply(this, args);
      if (object) live.add(object);
      return object;
    };
    proto[`delete${kind}`] = function (this: WebGL2RenderingContext, ...args: unknown[]): unknown {
      live.delete(args[0]);
      return remove.apply(this, args);
    };
  }

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

  return { liveGlObjects: () => live.size, openBitmaps: () => bitmaps.size };
}
