import { useEffect, useState } from 'react'
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import Logo from './components/Logo'
import WakeNotice from './components/WakeNotice'
import RequireAuth from './components/RequireAuth'
import { useAuth } from './lib/auth'
import AccountPage from './pages/AccountPage'
import CatalogPage from './pages/CatalogPage'
import DeckEditorPage from './pages/DeckEditorPage'
import DeckPage from './pages/DeckPage'
import DrawPage from './pages/DrawPage'
import HomePage from './pages/HomePage'
import LoginPage from './pages/LoginPage'
import NotFoundPage from './pages/NotFoundPage'
import PoolPage from './pages/PoolPage'
import PrivacyPage from './pages/PrivacyPage'
import RoomPage from './pages/RoomPage'
import SupportPage from './pages/SupportPage'

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `relative py-1 transition-colors hover:text-gold after:absolute after:inset-x-0 after:-bottom-0.5 after:h-px after:bg-gold after:transition-opacity ${
    isActive ? 'text-gold after:opacity-100' : 'text-parchment/70 after:opacity-0'
  }`

function AccountNav({ compact = false }: { compact?: boolean }) {
  const { user, ready, logout } = useAuth()
  if (!ready) return null
  if (!user)
    return (
      <NavLink
        to="/entrar"
        className="rounded-full border border-gold/40 px-3 py-1 text-center text-gold transition hover:bg-gold/10"
      >
        Entrar
      </NavLink>
    )
  return (
    <>
      <NavLink to="/minha-pool" className={linkClass}>
        Minha pool
      </NavLink>
      <span className={`flex items-center gap-2 ${compact ? 'justify-between' : ''}`}>
        <Link
          to="/conta"
          className="max-w-40 truncate rounded-full bg-gold/10 px-2.5 py-1 text-xs text-gold transition hover:bg-gold/20"
          title="Minha conta"
        >
          {user.username}
        </Link>
        <button onClick={logout} className="text-parchment/50 transition-colors hover:text-gold">
          Sair
        </button>
      </span>
    </>
  )
}

function Header() {
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  const [lastPath, setLastPath] = useState(pathname)
  // Fecha o menu do celular ao navegar
  if (pathname !== lastPath) {
    setLastPath(pathname)
    setOpen(false)
  }

  const links = (
    <>
      <NavLink to="/" end className={linkClass}>
        Sortear
      </NavLink>
      <NavLink to="/catalogo" className={linkClass}>
        Catálogo
      </NavLink>
    </>
  )

  return (
    <header className="sticky top-0 z-30 border-b border-gold/15 bg-ink/80 backdrop-blur-md">
      <nav className="mx-auto flex max-w-5xl items-center justify-between gap-6 px-4 py-3">
        <Link to="/" aria-label="Choose at random — início">
          <Logo />
        </Link>
        <div className="hidden items-center gap-5 text-sm sm:flex">
          {links}
          <AccountNav />
        </div>
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="menu-celular"
          aria-label={open ? 'Fechar menu' : 'Abrir menu'}
          className="rounded-lg p-2 text-parchment/80 hover:text-gold sm:hidden"
        >
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
      </nav>
      {open && (
        <div
          id="menu-celular"
          className="flex flex-col items-start gap-4 border-t border-gold/10 px-4 py-4 text-base sm:hidden"
        >
          {links}
          <AccountNav compact />
        </div>
      )}
    </header>
  )
}

// Volta ao topo ao trocar de página (o navegador não faz isso sozinho numa SPA)
function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => window.scrollTo(0, 0), [pathname])
  return null
}

export default function App() {
  return (
    <div className="flex min-h-dvh flex-col">
      <ScrollToTop />
      <WakeNotice />
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-gold focus:px-3 focus:py-2 focus:text-ink"
      >
        Pular para o conteúdo
      </a>
      <Header />

      <main id="conteudo" className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/catalogo" element={<CatalogPage />} />
          <Route path="/deck/:slug" element={<DeckPage />} />
          <Route path="/deck-usuario/:slug" element={<DeckPage kind="user" />} />
          <Route path="/sorteio/:code" element={<DrawPage />} />
          <Route path="/sala/:code" element={<RoomPage />} />
          <Route path="/entrar" element={<LoginPage />} />
          <Route path="/privacidade" element={<PrivacyPage />} />
          <Route path="/apoie" element={<SupportPage />} />
          <Route
            path="/conta"
            element={
              <RequireAuth>
                <AccountPage />
              </RequireAuth>
            }
          />
          <Route
            path="/minha-pool"
            element={
              <RequireAuth>
                <PoolPage />
              </RequireAuth>
            }
          />
          <Route
            path="/minha-pool/novo"
            element={
              <RequireAuth>
                <DeckEditorPage />
              </RequireAuth>
            }
          />
          <Route
            path="/minha-pool/deck/:id"
            element={
              <RequireAuth>
                <DeckEditorPage />
              </RequireAuth>
            }
          />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>

      <footer className="border-t border-gold/10">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-3 px-4 py-8 text-center text-xs text-parchment/45">
          <span className="flex items-center gap-2 font-display text-sm text-gold/70">Choose at random</span>
          <p className="max-w-2xl leading-relaxed">
            Choose at random é conteúdo de fã não oficial, permitido pela Fan Content Policy. Não é aprovado nem
            endossado pela Wizards of the Coast. Partes dos materiais usados são propriedade da Wizards of the Coast.
            Dados e imagens de cartas:{' '}
            <a href="https://scryfall.com" className="underline hover:text-gold">
              Scryfall
            </a>
            .
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
            <Link
              to="/apoie"
              className="rounded-full border border-gold/30 px-3 py-1 text-gold/80 transition hover:border-gold/60 hover:text-gold"
            >
              ☕ Apoie o projeto
            </Link>
            <Link to="/privacidade" className="underline hover:text-gold">
              Política de privacidade
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
