import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.tsx'
import { api, ApiError, isTransient } from './lib/api'
import { AuthProvider } from './lib/auth'
import LanguageProvider from './components/LanguageProvider'
import 'mana-font/css/mana.min.css'
import './index.css'

// O servidor gratuito dorme e leva até ~1 minuto para acordar. Em vez de desistir depois de
// 3 tentativas rápidas (e a página só voltar com F5), insiste por ~1 minuto quando o erro é
// passageiro. Erros "de verdade" (404, 403, validação) não são repetidos.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err) => isTransient(err) && count < 7,
      retryDelay: (count) => Math.min(1500 * 2 ** count, 15000),
      staleTime: 30_000,
    },
    mutations: {
      // Sem resposta / servidor acordando: a ação não chegou a rodar, dá para repetir
      retry: (count, err) => isTransient(err) && !(err instanceof ApiError && err.status === 429) && count < 3,
      retryDelay: (count) => Math.min(3000 * 2 ** count, 15000),
    },
  },
})

// Cutuca o backend logo na abertura: se ele estiver dormindo, já começa a acordar
// enquanto a pessoa ainda está lendo a página.
api.health().catch(() => undefined)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
      <AuthProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AuthProvider>
      </LanguageProvider>
    </QueryClientProvider>
  </StrictMode>,
)
