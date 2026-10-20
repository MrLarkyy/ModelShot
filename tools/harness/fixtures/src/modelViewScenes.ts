import { loadBbmodel, loadGltf } from '@modelshot/formats';
import type { SceneDocument } from '@modelshot/scene';
import alphaPlaneSource from '../../../../packages/formats/test/fixtures/bbmodel/alpha-plane.bbmodel?raw';
import meshShapesSource from '../../../../packages/formats/test/fixtures/bbmodel/mesh-shapes.bbmodel?raw';
import renderOrderSource from '../../../../packages/formats/test/fixtures/bbmodel/render-order.bbmodel?raw';
import sceneNodesSource from '../../../../packages/formats/test/fixtures/gltf/scene-nodes.gltf?raw';
import type { ModelViewModel } from './modelViewVariant';

/**
 * The scene of each model-view model, loaded by the real loaders from formats test fixtures (static imports only: the
 * page never loads a model named by the URL). `gltf-nodes` loads at half the default unit scale, so the whole model
 * fits the fixed camera, and hides its 50 % glass plane: this fixture draws cutout alpha only, and partial alpha is the
 * product renderers' (the realtime golden `rt-gltf-nodes-y030` shows the plane).
 */
export function modelViewScene(model: ModelViewModel): SceneDocument {
  switch (model) {
    case 'alpha-plane':
      return loadBbmodel(alphaPlaneSource).scene;
    case 'mesh-shapes':
      return loadBbmodel(meshShapesSource).scene;
    case 'render-order':
      return loadBbmodel(renderOrderSource).scene;
    case 'gltf-nodes':
      return hideMeshes(loadGltf(sceneNodesSource, { unitScale: 8 }).scene, ['glass-plane']);
  }
}

function hideMeshes(scene: SceneDocument, names: readonly string[]): SceneDocument {
  return {
    ...scene,
    meshes: scene.meshes.map((mesh) => (names.includes(mesh.name) ? { ...mesh, visible: false } : mesh)),
  };
}
