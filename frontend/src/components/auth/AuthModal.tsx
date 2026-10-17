import { type ElementType } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/animate-ui/components/radix/dialog'
import AuthArt from '@/components/auth/AuthArt'
import { LogoMark } from '@/components/Logo'
import { useT } from '@/lib/i18n'
import AuthForm, { type AuthMode } from './AuthForm'

/** Cabeçalho do formulário: título e uma linha de apoio, que mudam com a aba. */
export function AuthHeading({ mode, Title = 'h1', Description = 'p' }: {
  mode: AuthMode
  Title?: ElementType
  Description?: ElementType
}) {
  const t = useT()
  return (
    <div className="space-y-1.5">
      <Title className="font-display text-4xl text-parchment">
        {mode === 'login' ? t('Welcome back') : t('Take your seat')}
      </Title>
      <Description className="text-sm text-parchment/60">
        {mode === 'login'
          ? t('Sign in to open tables, build your deck pool and keep your history.')
          : t('With an account you can build your deck pool and join deals using the group’s decks.')}
      </Description>
    </div>
  )
}

/** Painel com a arte de um comandante, a marca e o convite (lado esquerdo do modal e da página /entrar). */
export function AuthShowcase() {
  const t = useT()
  return (
    <div className="relative isolate flex flex-col justify-between overflow-hidden p-8">
      <AuthArt />
      <LogoMark className="h-14 w-14 drop-shadow-[0_0_18px_rgb(255_120_30/0.45)]" />
      <div className="space-y-3">
        <p className="text-xs font-semibold tracking-[0.2em] text-gold uppercase">{t('Commander online')}</p>
        <p className="font-display text-4xl leading-[0.95] text-parchment">{t('Your table is waiting')}</p>
        <p className="max-w-xs text-sm text-parchment/65">
          {t('Open a table, send the link and play Commander with official precons or your own decks. No install.')}
        </p>
      </div>
    </div>
  )
}

/**
 * Modal de entrar/criar conta (Animate UI Dialog): arte de um comandante à esquerda no computador,
 * atrás do formulário no celular. Fecha sozinho quando a conta entra.
 */
export default function AuthModal({
  open,
  onDismiss,
  onSuccess,
  mode,
  onModeChange,
  notice,
}: {
  open: boolean
  onDismiss: () => void
  onSuccess: () => void
  mode: AuthMode
  onModeChange: (mode: AuthMode) => void
  notice?: string
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onDismiss()}>
      <DialogContent
        from="bottom"
        className="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto rounded-2xl border-gold/15 bg-ink p-0 shadow-[0_30px_80px_-20px_rgb(0_0_0/0.9),0_0_0_1px_rgb(236_185_63/0.06)] sm:max-w-[880px] md:grid md:grid-cols-[1fr_1.1fr] md:overflow-hidden [&>button]:z-10 [&>button]:text-parchment/70"
      >
        <div className="hidden md:flex">
          <AuthShowcase />
        </div>
        <div className="relative isolate space-y-6 p-6 sm:p-8 md:max-h-[calc(100dvh-2rem)] md:overflow-y-auto">
          {/* Celular: a arte fica atrás do formulário, bem escurecida */}
          <AuthArt className="opacity-40 md:hidden" credit={false} />
          <LogoMark className="h-10 w-10 md:hidden" />
          <AuthHeading mode={mode} Title={DialogTitle} Description={DialogDescription} />
          <AuthForm mode={mode} onModeChange={onModeChange} onSuccess={onSuccess} notice={notice} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
