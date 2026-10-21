// Class names shared by the hero island SVG and the illustration.css rules that colour it.
export const ISLAND_MATERIALS = ['grass', 'wood', 'foliage', 'lantern'] as const;
export const ISLAND_FACES = ['top', 'left', 'right'] as const;

export type IslandMaterial = (typeof ISLAND_MATERIALS)[number];
