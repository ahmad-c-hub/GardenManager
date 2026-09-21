import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Read the API port from the shared root .env so the dev proxy follows it.
  const { PORT } = loadEnv(mode, '..', '');

  return {
    plugins: [react()],
    // Read VITE_* variables from the shared .env in the project root.
    // Only VITE_-prefixed values are ever exposed to the browser.
    envDir: '..',
    build: {
      rollupOptions: {
        output: {
          // Split big libraries into their own long-cacheable chunks.
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom'],
            charts: ['recharts'],
            motion: ['framer-motion'],
          },
        },
      },
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: `http://localhost:${PORT || 3000}`,
          changeOrigin: false,
        },
      },
    },
  };
});
