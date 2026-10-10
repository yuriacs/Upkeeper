import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
import { useTitle } from '../hooks/useTitle'
import { useT } from '../lib/i18n'

const PLACEHOLDER = `1 Okaun, Eye of Chaos
1 Zndrsplt, Eye of Wisdom

1 Sol Ring
1 Arcane Signet
9 Island
...`

const inputClass =
  'w-full rounded-lg border border-gold/20 bg-ink px-4 py-2.5 placeholder:text-parchment/30 focus:border-gold focus:outline-none'

function Editor({ id, initial }: { id?: string; initial?: { name: string; decklist: string } }) {
  const t = useT()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [name, setName] = useState(initial?.name ?? '')
  const [decklist, setDecklist] = useState(initial?.decklist ?? '')
  const [commander, setCommander] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])

  const save = useMutation({
    mutationFn: () =>
      api.saveMyDeck({ name, decklist, commanders: commander.trim() ? [commander.trim()] : undefined }, id),
    onSuccess: (deck) => {
      queryClient.invalidateQueries({ queryKey: ['me'] })
      queryClient.invalidateQueries({ queryKey: ['deck', 'user', deck.slug] })
      if (deck.warnings.length) setWarnings(deck.warnings)
      navigate(`/deck-usuario/${deck.slug}`, { state: { warnings: deck.warnings } })
    },
  })

  const error = save.error instanceof ApiError ? save.error : null
  const needsCommander = !!error && /comandante|commander/i.test(error.message)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <label className="block space-y-1 text-sm">
        <span className="text-parchment/70">{t('Deck name')}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} className={inputClass} />
      </label>

      <label className="block space-y-1 text-sm">
        <span className="text-parchment/70">{t('Decklist')}</span>
        <textarea
          value={decklist}
          onChange={(e) => setDecklist(e.target.value)}
          required
          rows={16}
          placeholder={PLACEHOLDER}
          className={`${inputClass} font-mono text-xs leading-relaxed`}
        />
        <span className="text-xs text-parchment/40">
          {t(
            'Paste the Moxfield export (commander on the first line, or both partners on the first two, then a blank line). Archidekt, MTG Arena and "Commander"/"Deck" sections also work. With no blank line, the first card is the commander.',
          )}
        </span>
      </label>

      {(needsCommander || commander) && (
        <label className="block space-y-1 text-sm">
          <span className="text-parchment/70">{t('Commander (optional: fixes what was read from the list)')}</span>
          <input value={commander} onChange={(e) => setCommander(e.target.value)} className={inputClass} />
        </label>
      )}

      {error && (
        <div className="space-y-1 rounded-lg border border-red-400/30 bg-red-400/5 p-3 text-sm text-red-300">
          <p>{error.message}</p>
          {error.details.length > 0 && (
            <ul className="list-inside list-disc text-xs text-red-300/80">
              {error.details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {warnings.map((w) => (
        <p key={w} className="text-sm text-amber-400">
          {w}
        </p>
      ))}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={save.isPending}
          className="rounded-lg bg-gold px-6 py-3 font-semibold text-ink transition hover:brightness-110 disabled:opacity-50"
        >
          {save.isPending ? t('Fetching cards…') : id ? t('Save changes') : t('Import deck')}
        </button>
        <Link to="/minha-pool" className="rounded-lg border border-parchment/20 px-6 py-3 text-parchment/70">
          {t('Cancel')}
        </Link>
      </div>
    </form>
  )
}

export default function DeckEditorPage() {
  const t = useT()
  const { id } = useParams()
  useTitle(id ? t('Edit deck') : t('Import deck'))
  const existing = useQuery({ queryKey: ['me', 'deck', id], queryFn: () => api.myDeck(id!), enabled: !!id })

  return (
    <section className="mx-auto max-w-2xl space-y-6">
      <h1 className="font-display text-3xl text-gold">{id ? t('Edit deck') : t('Import deck')}</h1>
      {id && existing.isPending && <p className="text-parchment/60">{t('Loading…')}</p>}
      {id && existing.isError && <p className="text-red-400">{existing.error.message}</p>}
      {(!id || existing.data) && (
        <Editor
          key={id ?? 'novo'}
          id={id}
          initial={
            existing.data ? { name: existing.data.name, decklist: existing.data.decklist_text ?? '' } : undefined
          }
        />
      )}
    </section>
  )
}
