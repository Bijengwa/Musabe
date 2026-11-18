import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5190,
    strictPort: true, // fail loudly instead of silently moving to another port
    proxy: {
      // All /api calls go to the backend (backend/src/server.js).
      '/api': {
        target: 'http://localhost:4310',
        changeOrigin: true,
        configure: (proxy) => {
          // /api/events is a long-lived live-update stream. Every refresh, closed tab or backend restart
          // cuts it, and the proxy then prints ECONNRESET. That is normal (the page reconnects by itself),
          // so only report errors from other calls.
          proxy.removeAllListeners('error');
          proxy.on('error', (err, req, res) => {
            const live = req.url?.startsWith('/api/events');
            if (!(live && err.code === 'ECONNRESET')) console.error(`[proxy] ${req.url}: ${err.code || err.message}`);
            if (res && !res.headersSent && res.writeHead) { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end('{"error":"The server is not reachable. Try again."}'); }
            else res?.end?.();
          });
        },
      },
    },
  },
  preview: {
    proxy: {
      '/api': { target: 'http://localhost:4310', changeOrigin: true },
    },
  },
})
