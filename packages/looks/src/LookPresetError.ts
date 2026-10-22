export type LookPresetErrorCode =
  /** The text is longer than `MAX_LOOK_PRESET_LENGTH`. */
  | 'TOO_LARGE'
  /** The text is not JSON. */
  | 'SYNTAX'
  /** `format` is not `modelshot-look`. */
  | 'FORMAT'
  /** `version` is not one this build reads. */
  | 'VERSION'
  /** A value of the wrong type: not an object, not an array of three, not a finite number, not a string. */
  | 'TYPE'
  | 'MISSING'
  | 'UNKNOWN_KEY'
  /** A number outside its range. */
  | 'RANGE'
  /** A string or enum value that is not allowed (`id`, `name`, a `kind`). */
  | 'VALUE'
  /** A zero direction, or a key light less than 5° above the horizon. */
  | 'DIRECTION'
  /** Sky and ground give a dome that is negative somewhere. */
  | 'DOME';

/** An invalid look preset: `code` says what is wrong, `path` where (`lights.key.direction[1]`; empty: the root). */
export class LookPresetError extends Error {
  constructor(
    readonly code: LookPresetErrorCode,
    message: string,
    readonly path: string,
  ) {
    super(path ? `${path}: ${message}` : message);
    this.name = 'LookPresetError';
  }
}
