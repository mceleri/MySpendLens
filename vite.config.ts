import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'spa-fallback-filter',
      configureServer(server) {
        // Return a post-hook callback so it runs AFTER static file middleware (allowing public/ files to be served)
        // and BEFORE or intercepting the SPA index.html fallback
        return () => {
          server.middlewares.use((req, res, next) => {
            // Never serve index.html for model assets, json, or binary files not found on disk
            if (req.url && (
              req.url.startsWith('/models/') ||
              req.url.includes('/models/') ||
              req.url.includes('Xenova') ||
              /\.(json|onnx|wasm|bin|txt)(\?.*)?$/i.test(req.url)
            )) {
              res.statusCode = 404;
              res.end('File not found locally');
              return;
            }
            next();
          });
        };
      },
      configurePreviewServer(server) {
        return () => {
          server.middlewares.use((req, res, next) => {
            if (req.url && (
              req.url.startsWith('/models/') ||
              req.url.includes('/models/') ||
              req.url.includes('Xenova') ||
              /\.(json|onnx|wasm|bin|txt)(\?.*)?$/i.test(req.url)
            )) {
              res.statusCode = 404;
              res.end('File not found locally');
              return;
            }
            next();
          });
        };
      },
    },
  ],
  server: {
    host: '0.0.0.0',
    port: 3000,
    open: false,
    allowedHosts: true
  }
});
