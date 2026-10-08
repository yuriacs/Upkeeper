import { useMutation } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTitle } from '../hooks/useTitle'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'

export default function AccountPage() {
  useTitle('Minha conta')
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState(false)
  const [password, setPassword] = useState('')

  const exportData = useMutation({
    mutationFn: () => api.exportAccount(`choose-at-random-${user?.username}.json`),
  })
  const remove = useMutation({
    mutationFn: () => api.deleteAccount(password),
    onSuccess: async () => {
      await logout().catch(() => undefined)
      navigate('/', { replace: true })
    },
  })

  if (!user) return null

  return (
    <section className="mx-auto max-w-xl space-y-8">
      <div className="space-y-1">
        <h1 className="font-display text-3xl text-gold">Minha conta</h1>
        <p className="text-parchment/70">
          <strong className="text-parchment">{user.username}</strong> · {user.email}
        </p>
      </div>

      <div className="divide-y divide-gold/10 overflow-hidden rounded-xl border border-gold/15 bg-surface/60">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="font-semibold">Minha deckpool</p>
            <p className="text-sm text-parchment/60">Precons que você tem e decks importados.</p>
          </div>
          <Link
            to="/minha-pool"
            className="rounded-lg border border-gold/40 px-4 py-2 text-sm text-gold hover:bg-gold/10"
          >
            Abrir
          </Link>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="font-semibold">Baixar meus dados</p>
            <p className="text-sm text-parchment/60">Tudo o que guardamos sobre você, em um arquivo JSON.</p>
          </div>
          <button
            onClick={() => exportData.mutate()}
            disabled={exportData.isPending}
            className="rounded-lg border border-gold/40 px-4 py-2 text-sm text-gold hover:bg-gold/10 disabled:opacity-50"
          >
            {exportData.isPending ? 'Preparando…' : 'Baixar'}
          </button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="font-semibold">Sair</p>
            <p className="text-sm text-parchment/60">Encerra a sessão neste navegador.</p>
          </div>
          <button
            onClick={() => logout().then(() => navigate('/'))}
            className="rounded-lg border border-parchment/20 px-4 py-2 text-sm text-parchment/80 hover:border-parchment/40"
          >
            Sair
          </button>
        </div>
      </div>
      {exportData.isError && <p className="text-sm text-red-400">{exportData.error.message}</p>}

      <div className="space-y-3 rounded-xl border border-red-400/25 bg-red-400/5 p-4">
        <p className="font-semibold text-red-300">Excluir conta</p>
        <p className="text-sm text-parchment/70">
          Apaga para sempre seu e-mail, senha, decks importados e precons marcados. Nos sorteios antigos, seu nome vira
          "(conta excluída)". Não dá para desfazer.
        </p>
        {confirming ? (
          <form
            className="space-y-3"
            onSubmit={(e: FormEvent) => {
              e.preventDefault()
              remove.mutate()
            }}
          >
            <label className="block space-y-1 text-sm">
              <span className="text-parchment/70">Digite sua senha para confirmar</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                autoFocus
                className="w-full rounded-lg border border-red-400/30 bg-ink px-4 py-2.5 focus:border-red-400 focus:outline-none"
              />
            </label>
            {remove.isError && <p className="text-sm text-red-400">{remove.error.message}</p>}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={remove.isPending || !password}
                className="rounded-lg bg-red-500/80 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
              >
                {remove.isPending ? 'Excluindo…' : 'Excluir minha conta'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirming(false)
                  setPassword('')
                }}
                className="rounded-lg border border-parchment/20 px-4 py-2 text-sm text-parchment/70"
              >
                Cancelar
              </button>
            </div>
          </form>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="rounded-lg border border-red-400/40 px-4 py-2 text-sm text-red-300 hover:border-red-400/70"
          >
            Quero excluir minha conta
          </button>
        )}
      </div>

      <p className="text-center text-xs text-parchment/40">
        Veja a{' '}
        <Link to="/privacidade" className="underline hover:text-gold">
          política de privacidade
        </Link>
        .
      </p>
    </section>
  )
}
