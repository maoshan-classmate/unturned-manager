import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@unturned-manager/shared': path.resolve(__dirname, '../shared'),
    },
  },
  server: {
    port: 5173,
    // Vite 的 proxy 不走系统 HTTP_PROXY，直接转发到 localhost
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
      },
    },
  },
});
