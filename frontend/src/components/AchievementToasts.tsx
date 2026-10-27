import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ACHIEVEMENTS } from '../lib/achievements'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'
import { playSound } from '../lib/tableSounds'
import type { NewAchievement } from '../lib/types'

const SHOW_FOR = 8000 // ms na tela

/**
 * Aviso de conquista nova, em qualquer página do site (canto de baixo, acima dos convites). As
 * conquistas ganhas são consultadas a cada minuto e ao trocar de página; o aviso conta como visto
 * assim que aparece. Na mesa e no rever partida não aparece (a mesa já mostra no registro): fica
 * para a próxima página.
 */
export default function AchievementToasts() {
  const t = useT()
  const { user } = useAuth()
  const { pathname } = useLocation()
  const queryClient = useQueryClient()
  const atTable = pathname.startsWith('/table/') || pathname.startsWith('/replay/')
  const { data, refetch } = useQuery({
    queryKey: ['achievements-new'],
    queryFn: api.newAchievements,
    refetchInterval: 60_000,
    enabled: !!user && !atTable,
  })
  const { mutate: markSeen } = useMutation({
    mutationFn: (keys: string[]) => api.seenAchievements(keys),
    onSuccess: (res) => queryClient.setQueryData(['achievements-new'], res),
  })
  const [shown, setShown] = useState<NewAchievement[]>([])
  // Já avisadas nesta aba (a consulta pode voltar com elas antes de o "visto" chegar ao servidor)
  const handled = useRef(new Set<string>())

  // Trocou de página: confere de novo (ex.: acabou de sair da mesa ou de fazer um sorteio)
  useEffect(() => {
    if (user && !atTable) void refetch()
  }, [pathname, user, atTable, refetch])

  useEffect(() => {
    if (atTable) return
    const fresh = (data?.achievements ?? []).filter((a) => a.key in ACHIEVEMENTS && !handled.current.has(a.key))
    if (!fresh.length) return
    for (const a of fresh) handled.current.add(a.key)
    setShown((cur) => [...cur, ...fresh].slice(-3))
    playSound('win')
    markSeen(fresh.map((a) => a.key))
  }, [data, atTable, markSeen])

  useEffect(() => {
    if (!shown.length) return
    const timer = window.setTimeout(() => setShown((cur) => cur.slice(1)), SHOW_FOR)
    return () => window.clearTimeout(timer)
  }, [shown])

  if (!user || atTable || !shown.length) return null
  return (
    <div className="pointer-events-none fixed bottom-4 left-4 z-50 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2">
      {shown.map((a) => {
        const info = ACHIEVEMENTS[a.key]
        const Icon = info.icon
        return (
          <div
            key={a.key}
            role="status"
            className="pointer-events-auto flex animate-[fade-in_0.2s_ease-out] items-center gap-3 rounded-xl border border-gold/50 bg-ink/95 p-3 shadow-2xl shadow-black/70 backdrop-blur"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gold text-ink">
              <Icon className="h-5 w-5" aria-hidden />
            </span>
            <Link to={`/u/${encodeURIComponent(user.username)}`} className="min-w-0 flex-1">
              <p className="text-xs font-semibold tracking-wide text-gold uppercase">{t('Achievement unlocked')}</p>
              <p className="truncate font-semibold text-parchment">{info.name(t)}</p>
            </Link>
            <button
              type="button"
              onClick={() => setShown((cur) => cur.filter((c) => c.key !== a.key))}
              className="rounded p-1 text-parchment/50 hover:text-parchment"
              aria-label={t('Close')}
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        )
      })}
    </div>
  )
}
