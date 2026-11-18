import { defineConfig } from 'vitest/config';

// The balance bots (plan §8): `npm run test:balance`, not part of `npm test`.
export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify('test') },
  test: {
    include: ['tests/balance/**/*.balance.ts'],
  },
});
