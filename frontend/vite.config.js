import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/hearth/',
  server: {
    proxy: {
      '/hearth/api': {
        target: 'http://localhost:8100',
        rewrite: (path) => path.replace(/^\/hearth/, ''),
      }
    }
  },
  build: {
    outDir: 'dist',
  }
})
