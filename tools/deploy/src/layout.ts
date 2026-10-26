/** The embed path major: the folder `embed/v<n>/` of the site. It moves only with the embed contract version. */
export const EMBED_PATH_MAJOR = 1;

export interface DeployTarget {
  /** The built folder, relative to the repository root. */
  readonly source: string;
  /** Where it sits in the artifact: relative, ends with `/`; `./` is the artifact root. */
  readonly target: string;
}

/** What the hosted site is made of, in copy order: the landing page first, then the app and the embed beside it. */
export const DEPLOY_LAYOUT: readonly DeployTarget[] = [
  { source: 'packages/site/dist', target: './' },
  { source: 'packages/app/dist', target: 'app/' },
  { source: 'packages/embed/dist', target: `embed/v${EMBED_PATH_MAJOR}/` },
];
