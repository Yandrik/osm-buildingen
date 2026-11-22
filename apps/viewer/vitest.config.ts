import { defineConfig } from 'vitest/config';

// The root config only collects packages/*; run the viewer's pure-logic tests with `pnpm --filter @osm-buildingen/viewer test`.
export default defineConfig({
  test: { include: ['test/**/*.test.ts'] },
});
