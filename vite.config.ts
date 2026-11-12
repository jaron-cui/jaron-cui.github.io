/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Output to build/ so `npm run deploy` (gh-pages -d build) is unchanged from the CRA setup.
  build: { outDir: 'build', target: 'es2022', minify: process.env.NO_MINIFY ? false : 'oxc' },
  server: { port: 3000 },
  // Keep the MuJoCo WASM package unbundled so its `new URL('mujoco.wasm', import.meta.url)` resolves.
  optimizeDeps: { exclude: ['@mujoco/mujoco'] },
  worker: { format: 'es' },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // The rat demo's tests are parity checks against golden data that lives on the cluster.
    exclude: ['src/page/extraneous/rat-ncap/test/**', 'node_modules/**'],
  },
});
