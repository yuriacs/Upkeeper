import { Suspense, useEffect, useState } from 'react'
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import Logo from './components/Logo'
import WakeNotice from './components/WakeNotice'
import RequireAuth from './components/RequireAuth'
import { useAuth } from './lib/auth'
import { useI18n, useT } from './lib/i18n'
import { lazyPage } from './lib/lazyPage'
import HomePage from './pages/HomePage'

// A página inicial vem no pacote principal; as outras são baixadas quando alguém abre
const AccountPage = lazyPage(() => import('./pages/AccountPage'))
const AdminPage = lazyPage(() => import('./pages/AdminPage'))
const CatalogPage = lazyPage(() => import('./pages/CatalogPage'))
const DeckEditorPage = lazyPage(() => import('./pages/DeckEditorPage'))
const DeckPage = lazyPage(() => import('./pages/DeckPage'))
const DrawPage = lazyPage(() => import('./pages/DrawPage'))
const LoginPage = lazyPage(() => import('./pages/LoginPage'))
const MyDrawsPage = lazyPage(() => import('./pages/MyDrawsPage'))
const NotFoundPage = lazyPage(() => import('./pages/NotFoundPage'))
const PoolPage = lazyPage(() => import('./pages/PoolPage'))
const PrivacyPage = lazyPage(() => import('./pages/PrivacyPage'))
const RankingPage = lazyPage(() => import('./pages/RankingPage'))
const RoomPage = lazyPage(() => import('./pages/RoomPage'))
const SupportPage = lazyPage(() => import('./pages/SupportPage'))

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `relative py-1 transition-colors hover:text-gold after:absolute after:inset-x-0 after:-bottom-0.5 after:h-px after:bg-gold after:transition-opacity ${
    isActive ? 'text-gold after:opacity-100' : 'text-parchment/70 after:opacity-0'
  }`

function AccountNav({ compact = false }: { compact?: boolean }) {
  const { user, ready, logout } = useAuth()
  const t = useT()
  if (!ready) return null
  if (!user)
    return (
      <NavLink
        to="/entrar"
        className="rounded-full border border-gold/40 px-3 py-1 text-center text-gold transition hover:bg-gold/10"
      >
        {t('Sign in')}
      </NavLink>
    )
  return (
    <>
      <NavLink to="/minha-pool" className={linkClass}>
        {t('My pool')}
      </NavLink>
      <NavLink to="/meus-sorteios" className={linkClass}>
        {t('My history')}
      </NavLink>
      {user.is_admin && (
        <NavLink to="/painel" className={linkClass}>
          {t('Admin')}
        </NavLink>
      )}
      <span className={`flex items-center gap-2 ${compact ? 'justify-between' : ''}`}>
        <Link
          to="/conta"
          className="max-w-40 truncate rounded-full bg-gold/10 px-2.5 py-1 text-xs text-gold transition hover:bg-gold/20"
          title={t('My account')}
        >
          {user.username}
        </Link>
        <button onClick={logout} className="text-parchment/50 transition-colors hover:text-gold">
          {t('Sign out')}
        </button>
      </span>
    </>
  )
}

function LanguageSwitch() {
  const { lang, setLang } = useI18n()
  const options = [
    ['en', 'EN'],
    ['pt', 'PT'],
  ] as const
  return (
    <div role="group" aria-label="Language" className="inline-flex overflow-hidden rounded-full border border-gold/40 text-xs">
      {options.map(([code, label]) => (
        <button
          key={code}
          type="button"
          onClick={() => setLang(code)}
          aria-pressed={lang === code}
          className={`px-2.5 py-1 transition ${
            lang === code ? 'bg-gold text-ink' : 'text-gold/80 hover:bg-gold/10 hover:text-gold'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function Header() {
  const t = useT()
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
        {t('Deal')}
      </NavLink>
      <NavLink to="/catalogo" className={linkClass}>
        {t('Catalog')}
      </NavLink>
      <NavLink to="/ranking" className={linkClass}>
        Ranking
      </NavLink>
    </>
  )

  return (
    <header className="sticky top-0 z-30 border-b border-gold/15 bg-ink/80 backdrop-blur-md">
      <nav className="mx-auto flex max-w-5xl items-center justify-between gap-6 px-4 py-3">
        <Link to="/" aria-label={t('Choose at random — home')}>
          <Logo />
        </Link>
        <div className="hidden items-center gap-5 text-sm sm:flex">
          {links}
          <AccountNav />
          <LanguageSwitch />
        </div>
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="menu-celular"
          aria-label={open ? t('Close menu') : t('Open menu')}
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
          <LanguageSwitch />
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
  const t = useT()
  return (
    <div className="flex min-h-dvh flex-col">
      <ScrollToTop />
      <WakeNotice />
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-gold focus:px-3 focus:py-2 focus:text-ink"
      >
        {t('Skip to content')}
      </a>
      <Header />

      <main id="conteudo" className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">
        <Suspense fallback={<p className="text-center text-parchment/50">{t('Loading…')}</p>}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/ranking" element={<RankingPage />} />
            <Route path="/catalogo" element={<CatalogPage />} />
            <Route path="/deck/:slug" element={<DeckPage />} />
            <Route path="/deck-usuario/:slug" element={<DeckPage kind="user" />} />
            <Route path="/sorteio/:code" element={<DrawPage />} />
            <Route path="/sala/:code" element={<RoomPage />} />
            <Route path="/entrar" element={<LoginPage />} />
            <Route path="/privacidade" element={<PrivacyPage />} />
            <Route path="/apoie" element={<SupportPage />} />
            <Route path="/meus-sorteios" element={<MyDrawsPage />} />
            <Route path="/painel" element={<AdminPage />} />
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
        </Suspense>
      </main>

      <footer className="border-t border-gold/10">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-3 px-4 py-8 text-center text-xs text-parchment/45">
          <span className="flex items-center gap-2 font-display text-sm text-gold/70">Choose at random</span>
          <p className="max-w-2xl leading-relaxed">
            {t(
              'Choose at random is unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by Wizards of the Coast. Portions of the materials used are property of Wizards of the Coast.',
            )}{' '}
            {t('Card data and images:')}{' '}
            <a href="https://scryfall.com" className="underline hover:text-gold">
              Scryfall
            </a>
            . {t('Brackets estimated with')}{' '}
            <a href="https://commanderspellbook.com" className="underline hover:text-gold">
              Commander Spellbook
            </a>
            .
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
            <Link
              to="/apoie"
              className="rounded-full border border-gold/30 px-3 py-1 text-gold/80 transition hover:border-gold/60 hover:text-gold"
            >
              ☕ {t('Support the project')}
            </Link>
            <Link to="/privacidade" className="underline hover:text-gold">
              {t('Privacy policy')}
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
