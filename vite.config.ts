import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// BASE_PATH lets the same build run at a domain root (custom .ae domain) or under a sub-path (GitHub Pages).
export default defineConfig({
  base: process.env.BASE_PATH ?? './',
  plugins: [react()],
  build: { target: 'es2020', chunkSizeWarningLimit: 1500 },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
