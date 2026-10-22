import { Suspense, useEffect, useRef, useState } from 'react'
import { Award, ChevronDown, Dices, History, Layers, Library, LogOut, Shield, Swords, Trophy, UserRound, Users } from 'lucide-react'
import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Logo from './components/Logo'
import { AuthDialogProvider, useAuthDialog } from './components/auth/AuthDialog'
import WakeNotice from './components/WakeNotice'
import PageErrorBoundary from './components/PageErrorBoundary'
import RequireAuth from './components/RequireAuth'
import RecoveryCodeDialog from './components/RecoveryCodeDialog'
import InviteToasts from './components/InviteToasts'
import { useScrollReveal } from './hooks/useScrollReveal'
import { useAuth } from './lib/auth'
import { useI18n, useT } from './lib/i18n'
import { lazyPage } from './lib/lazyPage'
import { api } from './lib/api'
import { useQuery } from '@tanstack/react-query'
import HomePage from './pages/HomePage'

// A página inicial vem no pacote principal; as outras são baixadas quando alguém abre
const AccountPage = lazyPage(() => import('./pages/AccountPage'))
const AdminPage = lazyPage(() => import('./pages/AdminPage'))
const CatalogPage = lazyPage(() => import('./pages/CatalogPage'))
const ChangelogPage = lazyPage(() => import('./pages/ChangelogPage'))
const DeckEditorPage = lazyPage(() => import('./pages/DeckEditorPage'))
const DeckBuilderPage = lazyPage(() => import('./pages/DeckBuilderPage'))
const DeckPage = lazyPage(() => import('./pages/DeckPage'))
const DrawPage = lazyPage(() => import('./pages/DrawPage'))
const FriendsPage = lazyPage(() => import('./pages/FriendsPage'))
const ForgotPasswordPage = lazyPage(() => import('./pages/ForgotPasswordPage'))
const LoginPage = lazyPage(() => import('./pages/LoginPage'))
const OAuthCallbackPage = lazyPage(() => import('./pages/OAuthCallbackPage'))
const MyDrawsPage = lazyPage(() => import('./pages/MyDrawsPage'))
const ReplayPage = lazyPage(() => import('./pages/ReplayPage'))
const NotFoundPage = lazyPage(() => import('./pages/NotFoundPage'))
const PoolPage = lazyPage(() => import('./pages/PoolPage'))
const PrivacyPage = lazyPage(() => import('./pages/PrivacyPage'))
const ProfilePage = lazyPage(() => import('./pages/ProfilePage'))
const SocialPage = lazyPage(() => import('./pages/SocialPage'))
const RankingPage = lazyPage(() => import('./pages/RankingPage'))
const ResetPasswordPage = lazyPage(() => import('./pages/ResetPasswordPage'))
const RoomPage = lazyPage(() => import('./pages/RoomPage'))
const SupportPage = lazyPage(() => import('./pages/SupportPage'))
const TablePage = lazyPage(() => import('./pages/TablePage'))

// Links do menu: condensados e maiúsculos (como os títulos), com um marcador dourado no ativo
const linkClass = ({ isActive }: { isActive: boolean }) =>
  `font-display relative inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-2 text-[1.05rem] tracking-[0.08em] transition-colors hover:text-gold after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-gold after:shadow-[0_0_10px_rgb(236_185_63/0.8)] after:transition-opacity ${
    isActive ? 'text-parchment after:opacity-100' : 'text-parchment/80 after:opacity-0'
  }`

function AccountNav({ compact = false }: { compact?: boolean }) {
  const { user, ready, logout } = useAuth()
  const t = useT()
  const { openAuth } = useAuthDialog()
  if (!ready) return null
  if (!user)
    return (
      <span className={`flex items-center gap-2 ${compact ? 'flex-wrap' : ''}`}>
        <button
          type="button"
          onClick={() => openAuth('register')}
          className="rounded-full border border-gold/60 bg-ink/85 px-4 py-1.5 text-center text-[0.95rem] font-semibold text-gold backdrop-blur transition hover:border-gold hover:bg-[#1d1708]"
        >
          {t('Create account')}
        </button>
        <button
          type="button"
          onClick={() => openAuth('login')}
          className="btn-ember rounded-full px-5 py-1.5 text-center text-[0.95rem] font-semibold transition hover:brightness-110"
        >
          {t('Sign in')}
        </button>
      </span>
    )
  if (!compact) return <UserMenu />
  return (
    <>
      <NavLink to="/meus-sorteios" className={linkClass} title={t('My history')}>
        <History className="nav-icon" aria-hidden />
        <span className={compact ? '' : 'hidden xl:inline'}>{t('My history')}</span>
      </NavLink>
      <FriendsLink compact={compact} />
      {user.is_admin && (
        <NavLink to="/painel" className={linkClass} title={t('Admin')}>
          <Shield className="nav-icon" aria-hidden />
          <span className={compact ? '' : 'hidden xl:inline'}>{t('Admin')}</span>
        </NavLink>
      )}
      <span className={`flex items-center gap-2 ${compact ? 'justify-between' : ''}`}>
        <Link
          to="/conta"
          className="max-w-40 truncate rounded-full border border-parchment/30 px-2.5 py-1 text-xs font-semibold text-parchment transition hover:bg-parchment/10"
          title={t('My account')}
        >
          {user.username}
        </Link>
        <button onClick={logout} className="whitespace-nowrap text-parchment/65 transition-colors hover:text-gold">
          {t('Sign out')}
        </button>
      </span>
    </>
  )
}

/**
 * Computador: a conta num menu sob o nome (Meus sorteios, Amigos, Painel, Minha conta, Sair; a
 * Minha pool fica nos links principais). Assim a faixa do topo cabe em qualquer largura, mesmo com todos os links de quem entrou.
 */
function UserMenu() {
  const { user, logout } = useAuth()
  const t = useT()
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  // A cada 30 s: também mantém você "online" para os amigos e traz convites para mesa
  const { data } = useQuery({ queryKey: ['friends'], queryFn: api.friends, refetchInterval: 30_000 })
  const pending = data?.incoming.length ?? 0
  const [lastPath, setLastPath] = useState(pathname)
  if (pathname !== lastPath) {
    setLastPath(pathname)
    setOpen(false)
  }
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  if (!user) return null
  const item = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 px-3 py-2 text-sm transition ${
      isActive ? 'text-gold' : 'text-parchment/80 hover:bg-parchment/5 hover:text-parchment'
    }`
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex max-w-48 items-center gap-1.5 rounded-full border py-1 pr-2 pl-3 text-xs font-semibold transition ${
          open ? 'border-gold text-gold' : 'border-parchment/35 text-parchment hover:border-gold/70 hover:text-gold'
        }`}
      >
        <span className="truncate">{user.username}</span>
        {pending > 0 && (
          <span className="rounded-full bg-gold px-1.5 text-[0.65rem] font-bold text-ink" aria-label={t('{n} friend requests', { n: pending })}>
            {pending}
          </span>
        )}
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 opacity-70 transition ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute top-full right-0 z-40 mt-2 min-w-52 overflow-hidden rounded-lg border border-line bg-ink/95 py-1 shadow-xl shadow-black/60 backdrop-blur-md animate-[fade-in_0.15s_ease-out]"
        >
          <NavLink to="/meus-sorteios" role="menuitem" className={item}>
            <History className="h-4 w-4" aria-hidden />
            {t('My history')}
          </NavLink>
          <NavLink to="/amigos" role="menuitem" className={item}>
            <Users className="h-4 w-4" aria-hidden />
            <span className="flex-1">{t('Friends')}</span>
            {pending > 0 && <span className="rounded-full bg-gold px-1.5 text-[0.65rem] font-bold text-ink">{pending}</span>}
          </NavLink>
          {user.is_admin && (
            <NavLink to="/painel" role="menuitem" className={item}>
              <Shield className="h-4 w-4" aria-hidden />
              {t('Admin')}
            </NavLink>
          )}
          <div className="my-1 border-t border-line" />
          <NavLink to={`/u/${encodeURIComponent(user.username)}`} role="menuitem" className={item}>
            <Award className="h-4 w-4" aria-hidden />
            {t('My profile')}
          </NavLink>
          <NavLink to="/conta" role="menuitem" className={item}>
            <UserRound className="h-4 w-4" aria-hidden />
            {t('My account')}
          </NavLink>
          <button
            type="button"
            role="menuitem"
            onClick={logout}
            className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm text-parchment/80 transition hover:bg-parchment/5 hover:text-gold"
          >
            <LogOut className="h-4 w-4" aria-hidden />
            {t('Sign out')}
          </button>
        </div>
      )}
    </div>
  )
}

/** Amigos no menu, com o número de pedidos esperando resposta */
function FriendsLink({ compact = false }: { compact?: boolean }) {
  const t = useT()
  const { data } = useQuery({ queryKey: ['friends'], queryFn: api.friends, refetchInterval: 30_000 })
  const pending = data?.incoming.length ?? 0
  return (
    <NavLink to="/amigos" className={linkClass} title={t('Friends')}>
      <Users className="nav-icon" aria-hidden />
      <span className={compact ? '' : 'hidden xl:inline'}>{t('Friends')}</span>
      {pending > 0 && (
        <span
          className="ml-1.5 rounded-full bg-gold px-1.5 text-[0.65rem] font-bold text-ink"
          aria-label={t('{n} friend requests', { n: pending })}
        >
          {pending}
        </span>
      )}
    </NavLink>
  )
}

function LanguageSwitch({ align = 'right' }: { align?: 'left' | 'right' }) {
  const { lang, setLang } = useI18n()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const options = [
    ['en', 'EN', 'English'],
    ['pt', 'PT', 'Português'],
  ] as const
  const current = options.find(([code]) => code === lang) ?? options[0]

  // Fecha ao clicar fora ou apertar Esc
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Language: ${current[2]}`}
        className={`grid h-9 w-9 place-items-center rounded-full border text-xs font-bold tracking-wide transition ${
          open ? 'border-gold text-gold' : 'border-parchment/35 text-parchment/85 hover:border-gold/70 hover:text-gold'
        }`}
      >
        {current[1]}
      </button>
      {open && (
        <div
          role="menu"
          className={`absolute top-full z-40 mt-2 min-w-36 overflow-hidden rounded-lg border border-line bg-ink/95 py-1 shadow-xl shadow-black/60 backdrop-blur-md animate-[fade-in_0.15s_ease-out] ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {options.map(([code, short, name]) => (
            <button
              key={code}
              type="button"
              role="menuitemradio"
              aria-checked={lang === code}
              onClick={() => {
                setLang(code)
                setOpen(false)
              }}
              className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition ${
                lang === code ? 'text-gold' : 'text-parchment/80 hover:bg-parchment/5 hover:text-parchment'
              }`}
            >
              <span className="w-6 text-xs font-bold tracking-wide">{short}</span>
              <span className="flex-1">{name}</span>
              {lang === code && <span aria-hidden>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Header({ overlay = false }: { overlay?: boolean }) {
  const t = useT()
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const { pathname } = useLocation()
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  const [lastPath, setLastPath] = useState(pathname)
  // Fecha o menu do celular ao navegar
  if (pathname !== lastPath) {
    setLastPath(pathname)
    setOpen(false)
  }

  const links = (
    <>
      <NavLink to="/" end className={linkClass}>
        <Swords className="nav-icon" aria-hidden />
        {t('Play')}
      </NavLink>
      <NavLink to="/sortear" className={linkClass}>
        <Dices className="nav-icon" aria-hidden />
        {t('Deal')}
      </NavLink>
      <NavLink to="/catalogo" className={linkClass}>
        <Library className="nav-icon" aria-hidden />
        {t('Catalog')}
      </NavLink>
      <NavLink to="/ranking" className={linkClass}>
        <Trophy className="nav-icon" aria-hidden />
        Ranking
      </NavLink>
      {/* Minha pool em evidência, junto dos links principais (com conta) */}
      {user && (
        <NavLink to="/minha-pool" className={linkClass}>
          <Layers className="nav-icon" aria-hidden />
          {t('My pool')}
        </NavLink>
      )}
    </>
  )

  return (
    <header
      // Faixa escura e fixa: o menu fica legível ao rolar. Na página inicial ela flutua sobre a
      // capa e fica transparente no topo; a faixa escura só aparece ao rolar (ou com o menu aberto).
      className={`top-0 z-30 transition-[background-color,backdrop-filter] duration-300 ${
        overlay ? 'fixed inset-x-0' : 'sticky'
      } ${
        overlay && !scrolled && !open
          ? 'bg-gradient-to-b from-ink/80 to-transparent'
          : 'bg-ink/85 backdrop-blur-md'
      }`}
    >
      {/* Computador: logo à esquerda, navegação no centro, idioma e conta à direita */}
      <nav
        // Na capa: mais respiro no topo e nas laterais (mesma margem do conteúdo); ao rolar, a faixa encolhe
        className={`mx-auto flex items-center justify-between gap-6 transition-[padding] duration-300 lg:grid lg:grid-cols-[1fr_auto_1fr] ${
          overlay
            ? `max-w-[1600px] px-5 sm:px-8 lg:px-16 ${scrolled ? 'py-3' : 'py-5 sm:py-7'}`
            : 'max-w-6xl px-4 py-3 sm:px-6'
        }`}
      >
        <Link to="/" aria-label={t('Upkeeper — home')} className="justify-self-start">
          <Logo />
        </Link>
        <div className="hidden items-center gap-1 lg:flex">{links}</div>
        <div className="hidden items-center justify-end gap-4 text-sm lg:flex">
          <LanguageSwitch />
          <AccountNav />
        </div>
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="menu-celular"
          aria-label={open ? t('Close menu') : t('Open menu')}
          className="rounded-lg p-2 text-parchment/80 hover:text-gold lg:hidden"
        >
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
      </nav>
      {open && (
        <div
          id="menu-celular"
          className="flex flex-col items-start gap-4 border-t border-line bg-ink/95 px-4 py-4 text-base lg:hidden"
        >
          {links}
          <LanguageSwitch align="left" />
          <AccountNav compact />
        </div>
      )}
    </header>
  )
}

// Volta ao topo ao trocar de página (o navegador não faz isso sozinho numa SPA)
function ScrollToTop() {
  const { pathname } = useLocation()
  // Corpo com chaves: no Chrome novo, scrollTo devolve uma Promise, e o React trataria isso como
  // a função de limpeza do efeito ("l is not a function" ao trocar de página → tela em branco)
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

export default function App() {
  const t = useT()
  const { pathname } = useLocation()
  useScrollReveal()
  // Páginas com arte no topo (mesa inicial e sorteio): cabeçalho transparente e largura toda
  const isHome = pathname === '/' || pathname === '/sortear'
  // A mesa virtual usa a largura toda da tela
  const isTable = pathname.startsWith('/mesa/')
  // O deckbuilder usa a tela toda: busca, deck em colunas e estatísticas lado a lado
  const isBuilder = pathname.startsWith('/minha-pool/montar')
  return (
    <AuthDialogProvider>
      <div className="flex min-h-dvh flex-col">
        <ScrollToTop />
        <WakeNotice />
        <RecoveryCodeDialog />
        <InviteToasts />
        <a
          href="#conteudo"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-gold focus:px-3 focus:py-2 focus:text-ink"
        >
          {t('Skip to content')}
        </a>
        {/* Na mesa o menu do site sai: o campo dos oponentes usa a tela toda (sair fica na barra lateral) */}
        {!isTable && <Header overlay={isHome} />}

        {/* A página inicial ocupa a largura toda (arte no topo); as outras ficam num container */}
        <main
          id="conteudo"
          className={
            isHome || isTable
              ? 'w-full flex-1'
              : `mx-auto w-full flex-1 px-4 py-10 sm:px-6 ${isBuilder ? 'max-w-[110rem]' : 'max-w-6xl'}`
          }
        >
          <PageErrorBoundary resetKey={pathname}>
            <Suspense fallback={<p className="text-center text-parchment/50">{t('Loading…')}</p>}>
              <Routes>
                {/* A mesa virtual é a página inicial; o sorteio de decks fica em /sortear */}
                <Route path="/" element={<TablePage />} />
                <Route path="/sortear" element={<HomePage />} />
                <Route path="/ranking" element={<RankingPage />} />
                <Route path="/catalogo" element={<CatalogPage />} />
                <Route path="/deck/:slug" element={<DeckPage />} />
                <Route path="/deck-usuario/:slug" element={<DeckPage kind="user" />} />
                <Route path="/sorteio/:code" element={<DrawPage />} />
                <Route path="/sala/:code" element={<RoomPage />} />
                <Route path="/entrar" element={<LoginPage />} />
                <Route path="/entrar/social/:provider" element={<OAuthCallbackPage />} />
                <Route path="/esqueci-a-senha" element={<ForgotPasswordPage />} />
                <Route path="/redefinir-senha" element={<ResetPasswordPage />} />
                <Route path="/privacidade" element={<PrivacyPage />} />
                <Route path="/apoie" element={<SupportPage />} />
                <Route path="/novidades" element={<ChangelogPage />} />
                <Route path="/u/:username" element={<ProfilePage />} />
                <Route path="/meus-sorteios" element={<MyDrawsPage />} />
                <Route path="/partida/:id" element={<ReplayPage />} />
                <Route path="/painel" element={<AdminPage />} />
                <Route path="/painel/social" element={<SocialPage />} />
                <Route
                  path="/conta"
                  element={
                    <RequireAuth>
                      <AccountPage />
                    </RequireAuth>
                  }
                />
                <Route
                  path="/amigos"
                  element={
                    <RequireAuth>
                      <FriendsPage />
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
                  path="/minha-pool/montar"
                  element={
                    <RequireAuth>
                      <DeckBuilderPage />
                    </RequireAuth>
                  }
                />
                <Route
                  path="/minha-pool/montar/:id"
                  element={
                    <RequireAuth>
                      <DeckBuilderPage />
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
                <Route path="/mesa" element={<Navigate to="/" replace />} />
                <Route
                  path="/mesa/:code"
                  element={
                    <RequireAuth>
                      <TablePage />
                    </RequireAuth>
                  }
                />
                <Route path="*" element={<NotFoundPage />} />
              </Routes>
            </Suspense>
          </PageErrorBoundary>
        </main>

        {/* Na mesa virtual o rodapé sai: a mesa ocupa a tela toda */}
        <footer className={`border-t border-line ${isTable ? 'hidden' : ''}`}>
          <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-4 py-8 text-center text-xs text-parchment/45">
            <Logo className="h-7 opacity-80" />
            <p className="max-w-2xl leading-relaxed">
              {/* Aviso exigido pela Fan Content Policy da Wizards (regra 2) */}
              {(() => {
                const [before, after] = t(
                  'Upkeeper is unofficial Fan Content permitted under the {policy}. Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.',
                ).split('{policy}')
                return (
                  <>
                    {before}
                    <a
                      href="https://company.wizards.com/en/legal/fancontentpolicy"
                      target="_blank"
                      rel="noreferrer"
                      className="underline hover:text-gold"
                    >
                      Fan Content Policy
                    </a>
                    {after}
                  </>
                )
              })()}{' '}
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
                className="rounded-full border border-line px-3 py-1 text-gold/80 transition hover:border-parchment/40 hover:text-gold"
              >
                ☕ {t('Support the project')}
              </Link>
              <Link to="/novidades" className="underline hover:text-gold">
                {t("What's new")}
              </Link>
              <Link to="/privacidade" className="underline hover:text-gold">
                {t('Privacy policy')}
              </Link>
            </div>
          </div>
        </footer>
      </div>
    </AuthDialogProvider>
  )
}
