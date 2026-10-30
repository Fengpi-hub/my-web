import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 本地开发：将 /api 代理到本地 Worker（wrangler dev 默认 8787 端口）
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
})