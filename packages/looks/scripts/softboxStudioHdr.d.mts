export const WIDTH: number;
export const HEIGHT: number;
export function equirectDirection(u: number, v: number): [number, number, number];
export function softboxStudioRadiance(d: readonly [number, number, number]): [number, number, number];
export function softboxStudioImage(): { width: number; height: number; rgb: Float64Array };
export function softboxStudioHdr(): Uint8Array;
export function softboxStudioSh(): number[];
