import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, UserMinus, UserPlus, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useTitle } from '../hooks/useTitle'
import { api, ApiError } from '../lib/api'
import { useT } from '../lib/i18n'
import type { FriendItem, Friends } from '../lib/types'

const ERRORS: Record<string, string> = {
  user_not_found: 'No player with that username.',
  self: 'That is you.',
  already_friends: 'You are already friends.',
  already_sent: 'Request already sent. Waiting for an answer.',
  too_many: 'Too many friends and requests. Remove some first.',
}

/**
 * Amigos: mande um pedido pelo nome de usuário; a outra pessoa aceita. Amigos podem entrar nas
 * suas mesas "só amigos" (e você nas deles).
 */
export default function FriendsPage() {
  const t = useT()
  useTitle(t('Friends'))
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const list = useQuery({ queryKey: ['friends'], queryFn: api.friends })
  const update = (data: Friends) => queryClient.setQueryData(['friends'], data)
  const fail = (err: unknown) =>
    setNotice({
      ok: false,
      text: err instanceof ApiError ? t(ERRORS[err.message] ?? err.message) : t('Something went wrong. Try again.'),
    })
  const add = useMutation({
    mutationFn: (username: string) => api.addFriend(username),
    onSuccess: (data, username) => {
      update(data)
      setName('')
      const now = data.friends.some((f) => f.username.toLowerCase() === username.toLowerCase())
      setNotice({
        ok: true,
        text: now
          ? t('{name} had already asked: you are friends now.', { name: username })
          : t('Request sent to {name}.', { name: username }),
      })
    },
    onError: fail,
  })
  const accept = useMutation({ mutationFn: api.acceptFriend, onSuccess: update, onError: fail })
  const remove = useMutation({ mutationFn: api.removeFriend, onSuccess: update, onError: fail })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const clean = name.trim()
    setNotice(null)
    if (clean) add.mutate(clean)
  }
  const data = list.data
  const busy = accept.isPending || remove.isPending

  return (
    <section className="mx-auto max-w-2xl space-y-8">
      <div className="space-y-2">
        <h1 className="font-display text-3xl text-parchment sm:text-4xl">{t('Friends')}</h1>
        <p className="text-parchment/70">
          {t('Friends can join your "friends only" tables, and you can join theirs.')}
        </p>
      </div>

      <form onSubmit={submit} className="space-y-2">
        <label htmlFor="friend-name" className="text-xs font-semibold tracking-wide text-parchment/60 uppercase">
          {t('Add a friend by username')}
        </label>
        <div className="flex gap-2">
          <input
            id="friend-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={150}
            autoComplete="off"
            placeholder={t('Username')}
            className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-2 focus:border-gold focus:outline-none"
          />
          <button
            disabled={add.isPending || !name.trim()}
            className="inline-flex items-center gap-2 rounded-md btn-ember px-4 py-2 font-semibold text-ink transition hover:brightness-110 disabled:opacity-50"
          >
            <UserPlus className="h-4 w-4" aria-hidden />
            {t('Send request')}
          </button>
        </div>
        {notice && (
          <p role="status" className={`text-sm ${notice.ok ? 'text-emerald-300' : 'text-red-300'}`}>
            {notice.text}
          </p>
        )}
      </form>

      {list.isPending ? (
        <div className="h-32 animate-pulse rounded-lg border border-line bg-surface" />
      ) : list.isError ? (
        <p className="text-sm text-parchment/70">
          {t('Could not load your friends.')}{' '}
          <button onClick={() => list.refetch()} className="text-gold underline">
            {t('Try again')}
          </button>
        </p>
      ) : (
        data && (
          <>
            {data.incoming.length > 0 && (
              <Group title={t('Requests for you')} items={data.incoming}>
                {(f) => (
                  <>
                    <button
                      disabled={busy}
                      onClick={() => accept.mutate(f.id)}
                      className="inline-flex items-center gap-1.5 rounded-md btn-ember px-3 py-1 text-sm font-semibold text-ink hover:brightness-110 disabled:opacity-50"
                    >
                      <Check className="h-4 w-4" aria-hidden />
                      {t('Accept')}
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => remove.mutate(f.id)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1 text-sm hover:border-parchment/40 disabled:opacity-50"
                    >
                      <X className="h-4 w-4" aria-hidden />
                      {t('Decline')}
                    </button>
                  </>
                )}
              </Group>
            )}

            <Group title={t('Your friends ({n})', { n: data.friends.length })} items={data.friends}
              empty={t('No friends yet. Add someone by username above.')}>
              {(f) => <RemoveButton label={t('Remove {name} from your friends', { name: f.username })} disabled={busy} onConfirm={() => remove.mutate(f.id)} />}
            </Group>

            {data.outgoing.length > 0 && (
              <Group title={t('Waiting for an answer')} items={data.outgoing}>
                {(f) => (
                  <button
                    disabled={busy}
                    onClick={() => remove.mutate(f.id)}
                    className="rounded-md border border-line px-3 py-1 text-sm text-parchment/70 hover:border-parchment/40 disabled:opacity-50"
                  >
                    {t('Cancel request')}
                  </button>
                )}
              </Group>
            )}
          </>
        )
      )}
    </section>
  )
}

function Group({
  title,
  items,
  empty,
  children,
}: {
  title: string
  items: FriendItem[]
  empty?: string
  children: (f: FriendItem) => React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <h2 className="font-display text-xl text-parchment">{title}</h2>
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line p-4 text-center text-sm text-parchment/50">{empty}</p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface/60">
          {items.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
              <FriendName f={f} />
              {children(f)}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Nome (link para o perfil), se está online e em qual mesa (só nos amigos aceitos) */
function FriendName({ f }: { f: FriendItem }) {
  const t = useT()
  return (
    <span className="mr-auto flex min-w-0 items-center gap-2">
      {f.online !== undefined && (
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${f.online ? 'bg-emerald-400' : 'bg-parchment/20'}`}
          title={f.online ? t('Online') : t('Offline')}
          aria-label={f.online ? t('Online') : t('Offline')}
        />
      )}
      <Link to={`/u/${encodeURIComponent(f.username)}`} className="truncate font-semibold hover:text-gold">
        {f.username}
      </Link>
      {f.table && (
        <Link
          to={`/table/${f.table}`}
          className="shrink-0 rounded-full border border-emerald-400/40 px-2 py-0.5 text-xs text-emerald-300 hover:bg-emerald-400/10"
        >
          {t('at table {code}', { code: f.table })}
        </Link>
      )}
    </span>
  )
}

/** Desfazer amizade pede um segundo clique */
function RemoveButton({ label, disabled, onConfirm }: { label: string; disabled: boolean; onConfirm: () => void }) {
  const [sure, setSure] = useState(false)
  const t = useT()
  return (
    <button
      disabled={disabled}
      title={label}
      aria-label={label}
      onClick={() => {
        if (!sure) {
          setSure(true)
          setTimeout(() => setSure(false), 3000)
          return
        }
        onConfirm()
      }}
      className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1 text-sm transition disabled:opacity-50 ${
        sure ? 'border-red-400/60 text-red-300' : 'border-line text-parchment/60 hover:border-parchment/40'
      }`}
    >
      <UserMinus className="h-4 w-4" aria-hidden />
      {sure ? t('Click again to remove') : t('Remove')}
    </button>
  )
}
