// Landing goldens change only on a dev machine, deliberately (docs/site.md).
if (process.env.CI) {
  console.error('golden update refused: CI is set, landing goldens change only through pnpm golden:update:site');
  process.exit(1);
}
