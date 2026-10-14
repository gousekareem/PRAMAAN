import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const pkg = (p) => fileURLToPath(new URL(`../../packages/${p}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@pramaan/event-contracts': pkg('event-contracts'),
      '@pramaan/validation': pkg('validation'),
    },
  },
  test: { include: ['src/tests/**/*.test.ts'], environment: 'node' },
});
