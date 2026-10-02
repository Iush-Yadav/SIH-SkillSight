import { defineConfig } from 'vite';
import sessionApiPlugin from './server/sessionApi.js';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react(), sessionApiPlugin()],
  build: { rollupOptions: { output: { manualChunks(id) { if (id.includes('@tensorflow')) return 'vision-engine'; } } } },
});
