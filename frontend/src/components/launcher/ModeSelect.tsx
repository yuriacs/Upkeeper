import { ArrowRight, Dices, KeyRound, Swords } from 'lucide-react'
import { Dialog } from 'radix-ui'
import { useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { HOME_ART } from '@/lib/homeArt'
import { useGoToTable } from '@/hooks/useGoToTable'
import { useT } from '@/lib/i18n'

type Mode = 'new' | 'join' | 'deal'

/**
 * "Escolha o modo": três cartas grandes com arte de comandante (abrir mesa, entrar com
 * código, sortear decks). A carta em foco ganha a moldura dourada e mostra a descrição.
 */
export default function ModeSelect({
  open,
  onOpenChange,
  onNewTable,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onNewTable: () => void
}) {
  const t = useT()
  const navigate = useNavigate()
  const goToTable = useGoToTable()
  const items = HOME_ART
  const [focus, setFocus] = useState<Mode>('new')
  const [joining, setJoining] = useState(false)
  const [code, setCode] = useState('')
  // Três artes diferentes, sorteadas uma vez por visita
  const [seed] = useState(() => Math.floor(Math.random() * 1000))
  const art = (i: number) => (items.length ? items[(seed + i * 7) % items.length].art : null)

  const join = (e: FormEvent) => {
    e.preventDefault()
    const clean = code.trim().toUpperCase()
    if (/^[A-Z0-9]{4,12}$/.test(clean)) goToTable(`/table/${clean}`)
  }

  const cards: { mode: Mode; icon: ReactNode; title: string; text: string; action: () => void }[] = [
    {
      mode: 'new',
      icon: <Swords className="h-5 w-5" aria-hidden />,
      title: t('New table'),
      text: t('Get a code and send the link to your group (2 to 4 players).'),
      action: onNewTable,
    },
    {
      mode: 'join',
      icon: <KeyRound className="h-5 w-5" aria-hidden />,
      title: t('Join with code'),
      text: t('Got a code from your group? Type it and take your seat.'),
      action: () => setJoining(true),
    },
    {
      mode: 'deal',
      icon: <Dices className="h-5 w-5" aria-hidden />,
      title: t('Deal decks'),
      text: t('Deal precons or your group’s decks at random, with color and bracket rules, then play here.'),
      action: () => navigate('/draw'),
    },
  ]

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v)
        if (!v) setJoining(false)
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-8 overflow-y-auto px-4 py-10 outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:duration-300">
          <div className="text-center">
            <Dialog.Title className="font-epic text-3xl font-semibold tracking-wide text-parchment sm:text-4xl">
              {t('Select game mode')}
            </Dialog.Title>
            <Dialog.Description className="mt-2 text-sm text-parchment/55">
              {t('Open a table, send the link and play Commander with official precons or your own decks. No install.')}
            </Dialog.Description>
          </div>

          <div className="grid w-full max-w-4xl gap-4 sm:grid-cols-3">
            {cards.map((c, i) => {
              const active = focus === c.mode
              const image = art(i)
              return (
                <div
                  key={c.mode}
                  onMouseEnter={() => setFocus(c.mode)}
                  className={`group relative isolate flex aspect-[3/2] flex-col justify-end overflow-hidden rounded-lg border text-left transition duration-300 sm:aspect-[3/4.4] ${
                    active
                      ? 'border-gold/80 shadow-[0_0_0_1px_rgb(236_185_63/0.35),0_0_40px_-6px_rgb(236_185_63/0.45)]'
                      : 'border-parchment/10 opacity-80 hover:opacity-100'
                  }`}
                >
                  {/* Fundo de reserva enquanto a arte carrega (ou se ela falhar) */}
                  <div className="absolute inset-0 -z-20 bg-[radial-gradient(circle_at_50%_30%,#3a2a12,#0b0b0d_70%)]" />
                  {image && (
                    <img
                      src={image}
                      alt=""
                      onError={(e) => (e.currentTarget.style.display = 'none')}
                      className={`absolute inset-0 -z-10 h-full w-full object-cover transition duration-500 ${
                        active ? 'scale-105' : 'scale-100 grayscale-[35%]'
                      }`}
                    />
                  )}
                  <div className="absolute inset-0 -z-10 bg-gradient-to-t from-black via-black/55 to-black/10" />

                  {c.mode === 'join' && joining ? (
                    <form onSubmit={join} className="space-y-3 p-5">
                      <p className="font-epic text-xl text-parchment">{c.title}</p>
                      <input
                        autoFocus
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        placeholder={t('Table code')}
                        aria-label={t('Table code')}
                        maxLength={12}
                        className="h-11 w-full rounded-md border border-gold/40 bg-black/60 px-3 text-center tracking-[0.3em] uppercase placeholder:tracking-normal placeholder:normal-case placeholder:text-parchment/40 focus:border-gold focus:outline-none"
                      />
                      <button className="btn-ember flex h-10 w-full items-center justify-center gap-2 rounded-md font-semibold transition hover:brightness-110">
                        {t('Join')} <ArrowRight className="h-4 w-4" aria-hidden />
                      </button>
                    </form>
                  ) : (
                    <button
                      type="button"
                      onClick={c.action}
                      onFocus={() => setFocus(c.mode)}
                      className="flex flex-col items-center gap-2 p-5 text-center outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-gold"
                    >
                      <span className={`transition ${active ? 'text-gold' : 'text-parchment/60'}`}>{c.icon}</span>
                      <span className="font-epic text-xl tracking-wide text-parchment">{c.title}</span>
                      <span
                        className={`text-sm leading-snug text-parchment/75 transition-all duration-300 ${
                          active ? 'max-h-24 opacity-100' : 'max-h-0 opacity-0 sm:max-h-0'
                        } overflow-hidden`}
                      >
                        {c.text}
                      </span>
                    </button>
                  )}
                  {/* Ornamento da moldura em foco */}
                  <span
                    aria-hidden
                    className={`absolute bottom-0 left-1/2 h-2.5 w-2.5 -translate-x-1/2 translate-y-1/2 rotate-45 border border-gold bg-ink transition-opacity ${
                      active ? 'opacity-100' : 'opacity-0'
                    }`}
                  />
                </div>
              )
            })}
          </div>

          <Dialog.Close className="flex items-center gap-2 text-xs font-semibold tracking-[0.15em] text-parchment/70 uppercase transition hover:text-gold">
            <span className="keycap">ESC</span> {t('Back')}
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
