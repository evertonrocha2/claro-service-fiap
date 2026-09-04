import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Proxy em vez de CORS: o navegador vê tudo na mesma origem, então não há
    // preflight nem cabeçalho de origem para configurar no backend.
    proxy: {
      '/api': { target: 'http://localhost:3333', changeOrigin: true },
    },
  },
})
