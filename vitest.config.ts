import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['engine/test/**/*.test.ts', 'player/test/**/*.test.ts', 'tools/**/*.test.ts', 'reference/cubism/test/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'depreciated/**', 'assets/thirdparty/**'],
    environment: 'node',
  },
});
