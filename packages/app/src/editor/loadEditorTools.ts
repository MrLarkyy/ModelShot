// The overlay, picking, gizmo and timeline load after the first model is shown, so the empty app does not carry them.
export const loadEditorTools = (): Promise<typeof import('./EditorTools')> => import('./EditorTools');
