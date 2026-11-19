import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  // Read the API port from the shared root .env so the dev proxy follows it.
  const { PORT } = loadEnv(mode, '..', '');

  return {
    plugins: [
      react(),
      VitePWA({
        // Our own service worker (src/sw.js) so it can handle push events;
        // the plugin injects the precache list and bundles it to /sw.js.
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.js',
        // Registration is done by hand in main.jsx.
        injectRegister: false,
        // public/manifest.json is linked from index.html.
        manifest: false,
        injectManifest: {
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        },
      }),
    ],
    // Read VITE_* variables from the shared .env in the project root.
    // Only VITE_-prefixed values are ever exposed to the browser.
    envDir: '..',
    build: {
      rollupOptions: {
        output: {
          // Split big libraries into their own long-cacheable chunks.
          manualChunks: {
            // List the entry points actually imported (react-dom/client, the JSX runtime), or
            // react-dom can drift into the main chunk when another library pulls React in.
            react: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', 'react-router-dom'],
            zoom: ['react-zoom-pan-pinch'],
            charts: ['recharts'],
            motion: ['framer-motion'],
            markdown: ['react-markdown', 'remark-gfm'],
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
