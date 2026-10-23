// The export encoders load on first use, with the path tracer behind them.
export const loadExport = (): Promise<typeof import('@modelshot/export')> => import('@modelshot/export');
