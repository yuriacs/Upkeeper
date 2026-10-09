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
  return {
    name: 'absolute-meta-urls',
    transformIndexHtml: (html) => html.replaceAll('%SITE_URL%', url),
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
    },
  },
}))
