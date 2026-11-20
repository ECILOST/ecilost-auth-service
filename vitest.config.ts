import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`.
  plugins: [tsconfigPaths()],
  test: {
    coverage: {
      provider: 'v8',
      thresholds: { lines: 80 },
      reporter: ['text-summary', 'html', 'lcov'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/generated/**', '**/*.d.ts', '**/*.spec.*', '**/*.test.*'],
    },
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
  },
});
