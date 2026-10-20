export interface FixtureContext {
  gl: WebGL2RenderingContext;
  canvas: HTMLCanvasElement;
  renderer: string;
  floatRenderTargets: boolean;
}

export interface ContextOptions {
  /** A depth buffer on the default framebuffer; off by default. */
  depth?: boolean;
}

export function createContext(size: number, options: ContextOptions = {}): FixtureContext {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  document.body.appendChild(canvas);
  // preserveDrawingBuffer keeps the pixels readable from a later task than the draw.
  const gl = canvas.getContext('webgl2', {
    antialias: false,
    alpha: false,
    depth: options.depth ?? false,
    stencil: false,
    preserveDrawingBuffer: true,
  });
  if (!gl) throw new Error('WebGL2 is not available');
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  return { gl, canvas, renderer, floatRenderTargets: gl.getExtension('EXT_color_buffer_float') !== null };
}

export function requireFloatTargets(ctx: FixtureContext): void {
  if (!ctx.floatRenderTargets) throw new Error('EXT_color_buffer_float is required for float render targets');
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('could not create shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? '';
    gl.deleteShader(shader);
    throw new Error(`shader compile failed: ${log}`);
  }
  return shader;
}

export function createProgram(gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string): WebGLProgram {
  const program = gl.createProgram();
  const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? '';
    gl.deleteProgram(program);
    throw new Error(`program link failed: ${log}`);
  }
  return program;
}

export function readDrawingBufferBase64(gl: WebGL2RenderingContext, width: number, height: number): string {
  if (gl.isContextLost()) throw new Error('WebGL context lost');
  gl.finish();
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const pixels = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  let binary = '';
  for (let i = 0; i < pixels.length; i += 0x8000) {
    binary += String.fromCharCode(...pixels.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
