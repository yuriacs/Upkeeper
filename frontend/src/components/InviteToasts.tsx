import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Mail, X } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'
import { playSound } from '../lib/tableSounds'
import { useEffect, useRef } from 'react'

/**
 * Convites para mesa vindos de amigos, em qualquer página do site (canto de baixo). A lista de
 * amigos é consultada a cada 30 s (a mesma do menu); some ao entrar na mesa ou ao recusar.
 */
export default function InviteToasts() {
  const t = useT()
  const { user } = useAuth()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data } = useQuery({
    queryKey: ['friends'],
    queryFn: api.friends,
    refetchInterval: 30_000,
    enabled: !!user,
  })
  const dismiss = useMutation({
    mutationFn: (id: number) => api.dismissInvite(id),
    onSuccess: (res) => queryClient.setQueryData(['friends'], res),
  })
  // Já está na mesa do convite: nada a mostrar
  const here = pathname.startsWith('/mesa/') ? pathname.slice(6).toUpperCase() : null
  const invites = (data?.invites ?? []).filter((i) => i.code !== here).slice(0, 3)
  // Som de aviso quando chega um convite novo
  const heard = useRef(new Set<number>())
  useEffect(() => {
    let fresh = false
    for (const i of invites) {
      if (!heard.current.has(i.id)) {
        heard.current.add(i.id)
        fresh = true
      }
    }
    if (fresh) playSound('join')
  }, [invites])

  if (!user || !invites.length) return null
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2">
      {invites.map((i) => (
        <div
          key={i.id}
          role="status"
          className="pointer-events-auto flex animate-[fade-in_0.2s_ease-out] items-start gap-3 rounded-xl border border-gold/50 bg-ink/95 p-3 shadow-2xl shadow-black/70 backdrop-blur"
        >
          <Mail className="mt-0.5 h-5 w-5 shrink-0 text-gold" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm">
              {t('{name} invited you to table {code}', { name: i.from, code: i.code })}
            </p>
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => {
                  dismiss.mutate(i.id)
                  navigate(`/mesa/${i.code}`)
                }}
                className="rounded-md bg-gold px-3 py-1 text-sm font-semibold text-ink hover:brightness-110"
              >
                {t('Join')}
              </button>
              <button
                onClick={() => dismiss.mutate(i.id)}
                className="rounded-md border border-line px-3 py-1 text-sm text-parchment/70 hover:border-parchment/40"
              >
                {t('Decline')}
              </button>
            </div>
          </div>
          <button
            onClick={() => dismiss.mutate(i.id)}
            aria-label={t('Close')}
            className="rounded p-1 text-parchment/50 hover:text-parchment"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ))}
    </div>
  )
}
