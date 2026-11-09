// Image goldens change only on a dev machine, deliberately (docs/site.md, docs/app.md). `node refuseInCi.mjs <script>`
// names the root script the refusal points at; the default is the landing goldens.
if (process.env.CI) {
  const script = process.argv[2] ?? 'golden:update:site';
  console.error(`golden update refused: CI is set, these goldens change only through pnpm ${script}`);
  process.exit(1);
}
