export interface SceneMaterial {
  readonly name: string;
  /** Index into `SceneDocument.textures`, −1 for none. */
  readonly texture: number;
}
