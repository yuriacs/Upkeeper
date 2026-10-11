import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'

/**
 * WhatsApp, Discord etc. só mostram a imagem de prévia com URL absoluta.
 * Ordem: VITE_SITE_URL (se você definir) → domínio de produção que a Vercel informa no build → relativo.
 */
function siteUrl(mode: string): string {
  const env = loadEnv(mode, process.cwd(), '')
  const explicit = env.VITE_SITE_URL
  const vercel = env.VERCEL_PROJECT_PRODUCTION_URL
  const url = explicit || (vercel ? `https://${vercel}` : '')
  return url.replace(/\/+$/, '')
}

function absoluteMetaUrls(mode: string): Plugin {
  const url = siteUrl(mode)
  // Abre a conexão com a API (DNS + TLS) enquanto o JavaScript ainda baixa
  const api = loadEnv(mode, process.cwd(), '').VITE_API_URL?.replace(/\/+$/, '')
  const preconnect = api ? `<link rel="preconnect" href="${api}" crossorigin />` : ''
  return {
    name: 'absolute-meta-urls',
    transformIndexHtml: (html) => html.replaceAll('%SITE_URL%', url).replace('<!--api-preconnect-->', preconnect),
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), absoluteMetaUrls(mode)],
  server: {
    port: 5173,
    // Em dev, /api é repassado ao Django — sem dor de cabeça com CORS
    proxy: {
      '/api': 'http://localhost:8000',
      // Mesa virtual: rode o backend com uvicorn (WebSocket), não com runserver
      '/ws': { target: 'ws://localhost:8000', ws: true },
    },
  },
}))
