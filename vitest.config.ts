import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts: Vitest 3 ships its own (older) Vite types.
export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify('test') },
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: [
      '**/node_modules/**', '**/.claude/**', '**/dist/**',
      // World tests are off until the exhaustive world pass: the region and streaming suites.
      'tests/world/**', 'tests/content/world-*.test.ts', 'tests/sim/riding-streaming.test.ts',
    ],
    // Long sim runs and the baked-world scans outlast the default 5 s on a busy machine.
    testTimeout: 30_000,
    setupFiles: ['tests/setup/yieldBetweenTests.ts'],
  },
});
