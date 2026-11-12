import { DEFAULT_EXPORT_SETTINGS } from '../export/ExportSettings';
import { DEFAULT_RENDER_SETTINGS } from './RenderSettings';

/** Why Render and Export start from different sample counts; shown next to the field in both places. */
export function samplesNote(): string {
  return `Render uses ${DEFAULT_RENDER_SETTINGS.samples} samples by default for one still; Export uses ${DEFAULT_EXPORT_SETTINGS.samples} per frame because clips render many frames.`;
}
