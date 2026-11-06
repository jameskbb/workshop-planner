/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// GitHub Pages serves project sites from a /<repo>/ prefix, and the deploy workflow sets
// BASE_PATH to that prefix at build time. The default is relative because all routing happens in
// the URL hash, so one build works locally, on Pages and on any other static host.
const base = process.env.BASE_PATH ?? './';

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { port: 5173, strictPort: false },
  build: {
    // Everything the project list needs is ~110 kB; the editor, the 3D view, PDF/PNG export and
    // the workers are separate lazy chunks. The largest is the 3D vendor bundle (three + R3F +
    // drei), which only loads when someone opens the 3D view.
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // Keep the first paint (project list) small and let the big libraries cache separately.
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return;
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'vendor-react';
          if (/node_modules\/(konva|react-konva)\//.test(id)) return 'vendor-konva';
          if (id.includes('@radix-ui') || id.includes('@floating-ui')) return 'vendor-radix';
          // 3D is lazy; keeping three itself apart from the view code keeps every chunk small.
          if (/node_modules\/three\//.test(id)) return 'vendor-three';
          if (id.includes('@react-three/drei') || id.includes('three-stdlib') || id.includes('troika')) return 'vendor-drei';
          if (id.includes('@react-three/fiber') || id.includes('its-fine') || id.includes('react-reconciler')) return 'vendor-r3f';
          return;
        },
      },
    },
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/tests/setup.ts'],
  },
});
