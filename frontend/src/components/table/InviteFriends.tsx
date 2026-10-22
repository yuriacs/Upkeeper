import { useMutation, useQuery } from '@tanstack/react-query'
import { Check, UserPlus, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../lib/api'
import { useT } from '../../lib/i18n'

/**
 * Convidar amigos para esta mesa: lista os amigos (online primeiro) e manda o convite, que aparece
 * no site para eles. Quem já está sentado aqui não aparece.
 */
export function InviteFriends({ code, seated, onClose }: { code: string; seated: string[]; onClose: () => void }) {
  const t = useT()
  const friends = useQuery({ queryKey: ['friends'], queryFn: api.friends, refetchInterval: 30_000 })
  const [sent, setSent] = useState<Set<string>>(new Set())
  const invite = useMutation({
    mutationFn: (username: string) => api.inviteFriend(username, code),
    onSuccess: (_, username) => setSent((s) => new Set(s).add(username)),
  })
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  const here = new Set(seated.map((n) => n.toLowerCase()))
  const list = (friends.data?.friends ?? []).filter((f) => !here.has(f.username.toLowerCase()))
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={t('Invite friends')}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80dvh] w-full max-w-sm flex-col rounded-xl border border-line bg-surface shadow-2xl shadow-black"
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <UserPlus className="h-5 w-5 text-gold" aria-hidden />
          <h2 className="font-display text-xl">{t('Invite friends')}</h2>
          <button onClick={onClose} aria-label={t('Close')} className="ml-auto rounded p-1 text-parchment/50 hover:text-parchment">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
          {friends.isPending && <li className="px-4 py-6 text-center text-sm text-parchment/50">{t('Loading…')}</li>}
          {!friends.isPending && list.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-parchment/50">
              {t('No friends to invite.')}{' '}
              <Link to="/friends" className="text-gold underline">
                {t('Add friends')}
              </Link>
            </li>
          )}
          {list.map((f) => {
            const done = sent.has(f.username)
            return (
              <li key={f.id} className="flex items-center gap-2 px-4 py-2.5">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${f.online ? 'bg-emerald-400' : 'bg-parchment/20'}`}
                  title={f.online ? t('Online') : t('Offline')}
                />
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-semibold">{f.username}</span>
                  {f.table && <span className="ml-1.5 text-xs text-parchment/50">{t('at table {code}', { code: f.table })}</span>}
                </span>
                <button
                  onClick={() => invite.mutate(f.username)}
                  disabled={done || (invite.isPending && invite.variables === f.username)}
                  className={`inline-flex items-center gap-1 rounded-md px-3 py-1 text-sm font-semibold transition ${
                    done ? 'text-emerald-300' : 'bg-gold text-ink hover:brightness-110 disabled:opacity-50'
                  }`}
                >
                  {done ? <Check className="h-4 w-4" aria-hidden /> : null}
                  {done ? t('Invited') : t('Invite')}
                </button>
              </li>
            )
          })}
        </ul>
        {invite.isError && <p className="px-4 pb-3 text-sm text-red-400">{invite.error.message}</p>}
        <p className="border-t border-line px-4 py-2 text-xs text-parchment/45">
          {t('They get a notice on the site for the next 10 minutes.')}
        </p>
      </div>
    </div>
  )
}
