import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'spa-fallback-filter',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          // If a request is for /models/ or static model files, return 404 instead of falling back to index.html
          if (req.url && (req.url.startsWith('/models/') || req.url.includes('/models/'))) {
            res.statusCode = 404;
            res.end('Model file not found locally');
            return;
          }
          next();
        });
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
