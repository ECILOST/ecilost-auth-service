import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Aplica las migraciones una vez y siembra el entorno en cada worker.
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/setup-env.ts'],
    // Las pruebas comparten una sola base: ejecutarlas en paralelo las haria interferir.
    fileParallelism: false,
  },
});
