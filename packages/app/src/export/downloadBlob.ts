const REVOKE_AFTER_MS = 10_000;

/** A file name safe on every system: the model's name without its extension, plain characters, at most 60. */
export function exportFileName(modelName: string, extension: string): string {
  const base = modelName
    .replace(/\.[^.]*$/, '')
    .replace(/[^\w-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${base || 'model'}-modelshot.${extension.replace(/[^\w]/g, '')}`;
}

// Saves a Blob through an object URL of this page and a download link: no request is made, the URL is revoked soon.
export function downloadBlob(blob: Blob, modelName: string, extension: string): string {
  const name = exportFileName(modelName, extension);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
  return name;
}
