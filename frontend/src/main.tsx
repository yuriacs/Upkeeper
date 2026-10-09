import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.tsx'
import { api } from './lib/api'
import { AuthProvider } from './lib/auth'
import 'mana-font/css/mana.min.css'
import './index.css'

const queryClient = new QueryClient()

// Cutuca o backend logo na abertura: se ele estiver dormindo, já começa a acordar
// enquanto a pessoa ainda está lendo a página.
api.health().catch(() => undefined)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
)
