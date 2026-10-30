// What the embed reuses of the intake: the same limits, grouping and worker loader as the app (docs/embed.md).
export { checkIntake } from './checkIntake';
export { groupFiles, type LoadRequest } from './groupFiles';
export { IntakeError } from './IntakeError';
export type { LoadedModel, PlayerArmsChoice, ReferenceSource } from './LoadMessages';
export { LOAD_TIMEOUT_MS, loadModel, type LoadOptions } from './loadModel';
export { openModel, type ModelSession } from './openModel';
