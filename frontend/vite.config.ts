import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Em dev, /api é repassado ao Django — sem dor de cabeça com CORS
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
})
