// The path tracer (and with it the light bake, and the export encoders behind it) loads on first use, not with the page.
export const loadPathTracer = (): Promise<typeof import('@modelshot/pathtracer')> => import('@modelshot/pathtracer');
