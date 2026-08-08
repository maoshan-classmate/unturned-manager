import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { Agent } from 'node:http';

// 绕过系统 HTTP_PROXY——localhost 请求直连不走代理
const localAgent = new Agent();

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@unturned-manager/shared': path.resolve(__dirname, '../shared'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        agent: localAgent,
      },
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
        agent: localAgent,
      },
    },
  },
});
