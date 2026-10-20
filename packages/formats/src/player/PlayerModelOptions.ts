/** `classic`: 4-pixel arms (Steve); `slim`: 3-pixel arms, half a pixel lower (Alex). */
export type PlayerArms = 'classic' | 'slim';

export interface PlayerModelOptions {
  readonly arms: PlayerArms;
  /** Absent or `true`: the outer layer (hat, jacket, sleeves, pants) is visible; `false` hides its meshes. */
  readonly showOuterLayer?: boolean;
}
