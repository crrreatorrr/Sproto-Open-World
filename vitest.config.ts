import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts: Vitest 3 ships its own (older) Vite types.
export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify('test') },
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/.claude/**', '**/dist/**'],
  },
});
