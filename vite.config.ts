import { defineConfig } from 'vite';

// GitHub Pages serves project sites from https://<owner>.github.io/<repo>/.
// The repository is named SKYRUSH, so production builds use that subpath.
// Local dev and tests use "/" so the dev server and preview behave normally.
const repositoryName = 'SKYRUSH';

export default defineConfig(({ command }) => ({
  base: command === 'build' && process.env.SKYRUSH_BASE !== '/' ? `/${repositoryName}/` : '/',
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
        },
      },
    },
  },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: true,
    port: 4173,
    strictPort: true,
  },
}));
