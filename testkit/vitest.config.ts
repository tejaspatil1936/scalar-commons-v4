import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // One chain, one nonce stream per funded account: parallel files would race nonces.
    fileParallelism: false,
  },
});
