import { memo, useState } from 'react'
import { Eye } from 'lucide-react'
import { ChatText, LogText } from './CardLink'
import { useCardLookup } from './cardLookup'
import { logText } from './logText'
import { type LogItem, type TablePlayer } from '../../hooks/useTableSocket'
import { useAuth } from '../../lib/auth'
import { useT } from '../../lib/i18n'
import { SEAT_DOT } from './tableLook'

/** Mensagem de chat (de jogador ou de quem assiste) */
const isChat = (e: LogItem) => e.kind === 'chat' || e.kind === 'spectator_chat'

// memo: a mesa re-renderiza a cada clique, arraste e menu; o log só muda quando chega uma ação
export const TableLog = memo(function TableLog({
  log,
  players,
  onChat,
}: {
  log: LogItem[]
  /** Para ligar os nomes de carta à carta na mesa (prévia e destaque) */
  players: TablePlayer[]
  /** Sem: só leitura. Quem assiste também conversa (a mensagem vai marcada como de espectador) */
  onChat?: (text: string) => void
}) {
  const t = useT()
  const lookup = useCardLookup(players)
  const [tab, setTab] = useState<'all' | 'chat' | 'actions'>('all')
  const [text, setText] = useState('')
  // Mensagens novas de outras pessoas desde a última vez que a aba Chat foi aberta (as que já
  // estavam no log ao abrir a mesa não contam)
  const { user } = useAuth()
  const lastChatId = log.findLast(isChat)?.id ?? 0
  const [chatSeen, setChatSeen] = useState<number | null>(null)
  if (chatSeen === null && log.length > 0) setChatSeen(lastChatId)
  if (tab === 'chat' && chatSeen !== null && chatSeen < lastChatId) setChatSeen(lastChatId)
  const unread =
    chatSeen === null ? 0 : log.filter((e) => isChat(e) && (e.id ?? 0) > chatSeen && e.who !== user?.username).length
  const items = [...log]
    .reverse()
    // Conversa de quem assiste só aparece na aba Chat (o "Tudo" fica com o jogo e o chat dos jogadores)
    .filter((e) =>
      tab === 'all' ? e.kind !== 'spectator_chat' : tab === 'chat' ? isChat(e) : !isChat(e),
    )
  const tabs: [typeof tab, string][] = [
    ['all', t('All')],
    ['chat', t('Chat')],
    ['actions', t('Actions')],
  ]
  return (
    <div className="flex max-h-64 min-h-32 flex-1 flex-col rounded-lg border border-line bg-surface/60 lg:max-h-none lg:min-h-40">
      <div className="flex gap-4 border-b border-line px-3 pt-2 text-xs font-semibold tracking-wide uppercase">
        {tabs.map(([key, label]) => {
          const fresh = key === 'chat' && unread > 0
          return (
            <button
              key={key}
              onClick={() => setTab(key)}
              aria-label={fresh ? t('{label} ({n} new messages)', { label, n: unread }) : undefined}
              className={`inline-flex items-center gap-1.5 pb-1.5 ${
                tab === key
                  ? 'border-b-2 border-gold'
                  : fresh
                    ? 'animate-pulse text-gold'
                    : 'text-parchment/45 hover:text-parchment'
              }`}
            >
              {label}
              {fresh && (
                <span className="rounded-full bg-gold px-1.5 text-[0.6rem] leading-4 font-bold text-ink tabular-nums">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </button>
          )
        })}
      </div>
      <ol className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-2 text-xs text-parchment/70">
        {items.length === 0 && <li className="text-parchment/35">{t('Nothing happened yet.')}</li>}
        {items.map((e, i) => (
          <li key={e.id ?? log.length - i} className={isChat(e) ? 'text-parchment' : ''}>
            <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${SEAT_DOT[e.seat - 1] ?? 'bg-parchment/35'}`} />
            {e.kind === 'spectator_chat' ? (
              <>
                <span className="font-semibold text-parchment/75">{e.who}</span>{' '}
                <span className="mr-0.5 inline-flex items-center gap-0.5 rounded bg-sky-400/15 px-1 align-[1px] text-[0.6rem] font-semibold tracking-wide text-sky-300 uppercase">
                  <Eye className="h-2.5 w-2.5" aria-hidden />
                  {t('spectator')}
                </span>
                : <ChatText text={e.text ?? ''} lookup={lookup} />
              </>
            ) : e.kind === 'chat' ? (
              <>
                <span className="font-semibold">{e.who}:</span> <ChatText text={e.text ?? ''} lookup={lookup} />
              </>
            ) : (
              <LogText text={logText(t, e)} e={e} lookup={lookup} />
            )}
          </li>
        ))}
      </ol>
      {onChat && (
        <form
          className="flex gap-1.5 border-t border-line p-2"
          onSubmit={(e) => {
            e.preventDefault()
            // Enter envia e devolve o teclado para a mesa (os atalhos voltam a funcionar)
            ;(document.activeElement as HTMLElement | null)?.blur()
            if (!text.trim()) return
            onChat(text.trim().slice(0, 300))
            setText('')
          }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && e.currentTarget.blur()}
            maxLength={300}
            placeholder={t('Message… ([[card]] makes a link)')}
            title={t('Card names on the table become links. To link any card, write it as [[Card name]].')}
            id="table-chat"
            aria-label={t('Chat message')}
            className="min-w-0 flex-1 rounded-md border border-line bg-ink px-2 py-1 text-xs focus:border-gold focus:outline-none"
          />
          <button className="rounded-md bg-gold px-2.5 text-xs font-semibold text-ink">{t('Send')}</button>
        </form>
      )}
    </div>
  )
})
