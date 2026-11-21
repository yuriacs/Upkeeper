import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Play, Trash2, Upload } from 'lucide-react'
import { api, ApiError } from '../../lib/api'
import { useT } from '../../lib/i18n'
import type { AdminSound } from '../../lib/types'
import { playClip } from '../table/Soundboard'

/*
 * Painel do admin: os sons do soundboard da mesa. Só daqui se envia som (até 512 KB; o navegador
 * também confere se dura no máximo MAX_SECONDS). Renomear, trocar o emoji, mudar a ordem e apagar
 * valem na hora para todas as mesas.
 */

const MAX_BYTES = 512 * 1024
const MAX_SECONDS = 7

function duration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const a = new Audio()
    let done = false
    const finish = (secs: number | null) => {
      if (done) return
      done = true
      URL.revokeObjectURL(url)
      resolve(secs !== null && Number.isFinite(secs) ? secs : null)
    }
    a.preload = 'metadata'
    a.onloadedmetadata = () => finish(a.duration)
    a.onerror = () => finish(null)
    setTimeout(() => finish(null), 4000)
    a.src = url
  })
}

export default function AdminSounds() {
  const t = useT()
  const qc = useQueryClient()
  const list = useQuery({ queryKey: ['admin', 'sounds'], queryFn: api.adminSounds })
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'sounds'] })
    qc.invalidateQueries({ queryKey: ['sounds'] })
  }
  const errors: Record<string, string> = {
    no_file: t('Choose an audio file.'),
    no_name: t('Give the sound a name.'),
    too_big: t('The file is over 512 KB.'),
    too_many: t('Too many sounds: delete some first.'),
    not_audio: t('That file is not audio (MP3, OGG, WAV, WEBM or M4A).'),
  }
  const upload = useMutation({
    mutationFn: () => api.uploadSound(file!, name.trim(), emoji.trim()),
    onSuccess: () => {
      setFile(null)
      setName('')
      setEmoji('')
      if (fileInput.current) fileInput.current.value = ''
      refresh()
    },
    onError: (err) => setError(err instanceof ApiError ? (errors[err.message] ?? err.message) : String(err)),
  })
  const edit = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof api.editSound>[1] }) => api.editSound(id, patch),
    onSuccess: refresh,
  })
  const remove = useMutation({ mutationFn: (id: string) => api.deleteSound(id), onSuccess: refresh })
  // A duração vem do navegador e serve só para avisar cedo; quem decide se é áudio é o servidor
  const pick = async (f: File | null) => {
    setError(null)
    setFile(null)
    if (!f) return
    if (f.size > MAX_BYTES) return setError(errors.too_big)
    const secs = await duration(f)
    // Duração ilegível no navegador (MP3 de conversor, codec raro): o servidor confere se é áudio
    if (secs !== null && secs > MAX_SECONDS + 0.3) return setError(t('The sound has {n} s: keep it up to {max} s.', { n: secs.toFixed(1), max: MAX_SECONDS }))
    setFile(f)
    if (!name) setName(f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 32))
  }
  const sounds = list.data?.sounds ?? []
  // Trocar a ordem com o vizinho: os dois ganham posições seguidas
  const move = (s: AdminSound, dir: -1 | 1) => {
    const i = sounds.indexOf(s)
    const other = sounds[i + dir]
    if (!other) return
    sounds.forEach((x, j) => {
      const want = j === i ? i + dir : j === i + dir ? i : j
      if (x.position !== want) edit.mutate({ id: x.id, patch: { position: want } })
    })
  }
  const input = 'rounded-md border border-line bg-ink px-2 py-1 text-sm outline-none focus:border-gold'
  return (
    <section className="space-y-3 rounded-lg border border-line bg-surface/60 p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-gold/70">{t('Table soundboard')}</h2>
      <p className="text-xs text-parchment/50">
        {t('Only admins add sounds. Up to 512 KB and {max} seconds; players can mute them at the table.', { max: MAX_SECONDS })}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          setError(null)
          if (!file) return setError(errors.no_file)
          if (!name.trim()) return setError(errors.no_name)
          upload.mutate()
        }}
        className="flex flex-wrap items-center gap-2"
      >
        <input
          ref={fileInput}
          type="file"
          accept="audio/*"
          onChange={(e) => void pick(e.target.files?.[0] ?? null)}
          className="max-w-full text-xs file:mr-2 file:rounded-md file:border file:border-line file:bg-transparent file:px-2 file:py-1 file:text-parchment"
        />
        <input value={emoji} onChange={(e) => setEmoji(e.target.value)} placeholder="🔊" maxLength={16} aria-label={t('Emoji')} className={`${input} w-14 text-center`} />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('Name')} maxLength={32} aria-label={t('Name')} className={`${input} min-w-0 flex-1`} />
        {file && (
          <button type="button" onClick={() => playClip(URL.createObjectURL(file), 0.8)} className={`${input} inline-flex items-center gap-1 hover:text-gold`}>
            <Play className="h-3.5 w-3.5" aria-hidden />
            {t('Listen')}
          </button>
        )}
        <button
          disabled={upload.isPending}
          className="inline-flex items-center gap-1.5 rounded-md bg-gold px-3 py-1 text-sm font-semibold text-ink hover:brightness-110 disabled:opacity-50"
        >
          <Upload className="h-4 w-4" aria-hidden />
          {upload.isPending ? t('Sending…') : t('Add sound')}
        </button>
      </form>
      {error && <p className="text-sm text-red-300">{error}</p>}
      {list.isPending ? (
        <p className="text-sm text-parchment/50">{t('Loading…')}</p>
      ) : !sounds.length ? (
        <p className="text-sm text-parchment/50">{t('No sounds yet.')}</p>
      ) : (
        <ul className="divide-y divide-line/60">
          {sounds.map((s, i) => (
            <li key={s.id} className="flex items-center gap-2 py-1.5">
              <span className="flex flex-col">
                <button type="button" disabled={i === 0} onClick={() => move(s, -1)} aria-label={t('Move up')} className="text-parchment/50 hover:text-gold disabled:opacity-20">
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button type="button" disabled={i === sounds.length - 1} onClick={() => move(s, 1)} aria-label={t('Move down')} className="text-parchment/50 hover:text-gold disabled:opacity-20">
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
              </span>
              <button type="button" onClick={() => playClip(s.url, 0.8)} aria-label={t('Listen')} className="grid h-7 w-7 place-items-center rounded-md border border-line hover:border-gold hover:text-gold">
                <Play className="h-3.5 w-3.5" />
              </button>
              <input
                defaultValue={s.emoji}
                maxLength={16}
                aria-label={t('Emoji')}
                onBlur={(e) => e.target.value.trim() !== s.emoji && edit.mutate({ id: s.id, patch: { emoji: e.target.value.trim() } })}
                className={`${input} w-12 text-center`}
              />
              <input
                defaultValue={s.name}
                maxLength={32}
                aria-label={t('Name')}
                onBlur={(e) => {
                  const v = e.target.value.trim()
                  if (!v) e.target.value = s.name
                  else if (v !== s.name) edit.mutate({ id: s.id, patch: { name: v } })
                }}
                className={`${input} min-w-0 flex-1`}
              />
              <span className="w-14 text-right text-xs tabular-nums text-parchment/45">{Math.round(s.size / 1024)} KB</span>
              <button
                type="button"
                onClick={() => {
                  if (confirm !== s.id) {
                    setConfirm(s.id)
                    setTimeout(() => setConfirm((c) => (c === s.id ? null : c)), 3000)
                    return
                  }
                  setConfirm(null)
                  remove.mutate(s.id)
                }}
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition ${
                  confirm === s.id ? 'border-red-400 bg-red-500/20 text-red-200' : 'border-line text-parchment/60 hover:border-red-400/60 hover:text-red-300'
                }`}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                {confirm === s.id ? t('Click again to delete') : t('Delete')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
