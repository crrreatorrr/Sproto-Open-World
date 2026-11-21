import { defineConfig } from 'vitest/config';

// The world suites (`npm run test:world`): streaming policy, region merges and the baked-world
// scans. They stay out of `npm test` until the exhaustive world pass (see AGENTS.md).
export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify('test') },
  test: {
    include: ['tests/world/**/*.test.ts', 'tests/content/world-*.test.ts', 'tests/sim/riding-streaming.test.ts'],
    testTimeout: 60_000,
    setupFiles: ['tests/setup/yieldBetweenTests.ts'],
  },
});
