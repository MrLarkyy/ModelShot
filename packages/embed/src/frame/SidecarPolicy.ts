import { ACCEPTED_RESOURCE_EXTENSIONS } from '@modelshot/formats';

/** What a model's loader takes as a file next to it, and the name it looks a reference up by. */
export interface SidecarPolicy {
  /** File name endings (lower case) the loader reads; a reference to anything else is skipped. */
  readonly extensions: readonly string[];
  /** The loader looks a reference up by its percent-decoded base name (glTF, OBJ); else by the base name as written. */
  readonly decodedName: boolean;
}

/** glTF and OBJ: buffers, PNG and JPEG images, material libraries, found by the percent-decoded name. */
export const MODEL_SIDECARS: SidecarPolicy = Object.freeze({
  extensions: ACCEPTED_RESOURCE_EXTENSIONS,
  decodedName: true,
});

/** `.bbmodel`: PNG textures only (a JPEG fails the loader), found by the base name as written. */
export const BBMODEL_SIDECARS: SidecarPolicy = Object.freeze({ extensions: ['.png'], decodedName: false });
