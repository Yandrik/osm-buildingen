import { defineConfig } from 'vitest/config';

// The root config only covers packages/*; the studio's pure modules are tested here.
export default defineConfig({
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
