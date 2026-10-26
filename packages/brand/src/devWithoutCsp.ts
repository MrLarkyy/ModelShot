const CSP_META = /[ \t]*<meta\b[^>]*\bhttp-equiv\s*=\s*["']content-security-policy["'][^>]*>\r?\n?/gi;

/** Takes the Content-Security-Policy meta out of the dev server's page: the dev server injects inline styles it refuses. A build keeps it. */
export function devWithoutCsp(): {
  readonly name: string;
  readonly apply: 'serve';
  readonly transformIndexHtml: { readonly order: 'pre'; readonly handler: (html: string) => string };
} {
  return {
    name: 'modelshot:dev-without-csp',
    apply: 'serve',
    transformIndexHtml: { order: 'pre', handler: (html) => html.replace(CSP_META, '') },
  };
}
