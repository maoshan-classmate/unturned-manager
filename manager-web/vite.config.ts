import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { Agent } from 'node:http';

// 绕过系统 HTTP_PROXY——localhost 请求直连不走代理。
// http-proxy 会读 HTTP_PROXY/HTTPS_PROXY 环境变量走代理，代理访问后端会超时。
// 强制删除代理环境变量，确保 Vite 代理直连后端 3001。
delete process.env.HTTP_PROXY;
delete process.env.HTTPS_PROXY;
delete process.env.http_proxy;
delete process.env.https_proxy;
delete process.env.ALL_PROXY;
delete process.env.all_proxy;
process.env.NO_PROXY = '*';
process.env.no_proxy = '*';

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
        // ★ 修复 vite proxy ECONNRESET：透传 Origin 头 + 代理层错误自动重连 + 关闭空闲超时
        rewriteWsOrigin: false,
        reconnectOnError: () => true,
        timeout: 0,
      },
    },
  },
});
