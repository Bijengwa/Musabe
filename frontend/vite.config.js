import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5190,
    strictPort: true, // fail loudly instead of silently moving to another port
    proxy: {
      // All /api calls go to the backend (backend/src/server.js).
      '/api': { target: 'http://localhost:4310', changeOrigin: true },
    },
  },
  preview: {
    proxy: {
      '/api': { target: 'http://localhost:4310', changeOrigin: true },
    },
  },
})
