import { createPlayerModel, loadBbmodel, loadSkin, type PlayerArms } from '@modelshot/formats';
import {
  attachModel,
  playerPosePreset,
  poseScene,
  type PlayerPosePresetName,
  type SceneDocument,
  type Vec3,
} from '@modelshot/scene';
import singleCubeSource from '../../../../packages/formats/test/fixtures/bbmodel/single-cube.bbmodel?raw';
import classicUri from '../../../../packages/formats/test/fixtures/skins/skin-classic.png?inline';
import legacyUri from '../../../../packages/formats/test/fixtures/skins/skin-legacy.png?inline';
import slimUri from '../../../../packages/formats/test/fixtures/skins/skin-slim.png?inline';

const SKINS = { classic: classicUri, slim: slimUri, legacy: legacyUri } as const;

export type PlayerSkin = keyof typeof SKINS;

/**
 * The cube held in the right hand: `single-cube.bbmodel` (8 units, base at y 0) at half size, turned 45° about the
 * hand's vertical so no face is coplanar with the arm, its top 0.5 inside the fist. Its centre therefore sits 1.5 units
 * below the hand anchor in the hand's frame, whatever the pose (e2e/realtime.spec.ts relies on that).
 */
export const HELD_CUBE = Object.freeze({
  bone: 'right_hand',
  name: 'held-cube',
  scale: 0.5,
  offset: [0, -3.5, 0] as Vec3,
  rotation: [0, 45, 0] as Vec3,
});

function skinBytes(skin: PlayerSkin): Uint8Array {
  const uri = SKINS[skin];
  return Uint8Array.from(atob(uri.slice(uri.indexOf(',') + 1)), (c) => c.charCodeAt(0));
}

/** The player with a generated test skin (packages/formats/test/fixtures/skins), at rest. */
export function playerScene(skin: PlayerSkin, arms: PlayerArms): SceneDocument {
  return createPlayerModel(loadSkin(skinBytes(skin), { name: `skin-${skin}.png` }), { arms });
}

/** `doc` in a preset pose. */
export function posedPlayer(doc: SceneDocument, preset: PlayerPosePresetName): SceneDocument {
  const pose = playerPosePreset(preset);
  if (!pose) throw new Error(`no pose preset ${preset}`);
  return poseScene(doc, pose).document;
}

/** `doc` in a preset pose with `HELD_CUBE` attached to its right hand. */
export function holdingCube(doc: SceneDocument, preset: PlayerPosePresetName): SceneDocument {
  const cube = loadBbmodel(singleCubeSource).scene;
  return attachModel(posedPlayer(doc, preset), cube, HELD_CUBE);
}

/**
 * The holding player for the model-view fixture, whose camera frames about 16 units: on a stage node at 0.6 scale,
 * turned to face +Z (the camera's side).
 */
export function modelViewPlayer(): SceneDocument {
  const stage: SceneDocument = {
    formatVersion: 1,
    source: { format: 'player', formatVersion: '64x64', modelFormat: 'classic' },
    nodes: [
      {
        name: 'stage',
        sourceId: '',
        parent: -1,
        children: [],
        pivot: [0, 0, 0],
        rotation: [0, 0, 0],
        translation: [0, 0, 0],
        visible: true,
        meshes: [],
      },
    ],
    meshes: [],
    materials: [],
    textures: [],
    rootNodes: [0],
  };
  const player = holdingCube(playerScene('classic', 'classic'), 'hold');
  return attachModel(stage, player, { bone: 'stage', name: 'player', scale: 0.6, rotation: [0, 180, 0] });
}
