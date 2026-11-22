import { defineConfig } from 'vite';

// Fixed ports, different from the studio (5173 / 4173), so "open in studio" links stay valid.
export default defineConfig({
  server: { port: 5174, strictPort: true },
  preview: { port: 4174, strictPort: true },
  // Module workers that import other modules need ES output in the build.
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
