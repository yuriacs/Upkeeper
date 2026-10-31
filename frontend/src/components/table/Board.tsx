import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { Ban, Eye } from 'lucide-react'
import { BOARD_CARD, useTableSettings } from '../../lib/tableSettings'
import { setHoverPreview, useHoverPreview } from '../../lib/hoverPreview'
import { Tombstone } from '../../lib/icons'
import { cardImage, smallImage } from '../../lib/cardImage'
import { CardBack, CardPreviewPanel, CardView, DropZone, SymbolStrip } from './TableKit'
import { CARD_RATIO, dragInfo, useTable, zoneLabel } from './tableUtils'
import { type FieldCard, type TableCard, type TablePlayer, type ZoneName } from '../../hooks/useTableSocket'
import { useT } from '../../lib/i18n'
import { isUploadedImage } from '../../lib/moderation'
import SupporterBadge from '../SupporterBadge'
import { Avatar, ManaBox, PerkImageReport } from './PlayerPanel'
import { CMD_LABEL, CMD_PAD, CMD_STAT, REF_BOARD, SEAT_TINT, SMALL_MIN, clamp01 } from './tableLook'

/** Campo de um jogador: as cartas ficam onde o dono soltou (posição em fração do campo). */
export function Board({
  seat,
  player,
  size,
  mine,
  facing,
  selected,
  active,
  onSelect,
  onPickDeck,
  onOpenZone,
  choosing,
  shaking,
  selection,
  onMarquee,
  onClearSelection,
}: {
  seat: number
  player: TablePlayer | null
  size: 'large' | 'small'
  mine: boolean
  /**
   * Campo de baixo, do ponto de vista do dono (o seu ou, assistindo, o de quem você segue): os
   * terrenos ficam embaixo. Os outros campos são espelhados (terrenos longe de você)
   */
  facing: boolean
  selected: boolean
  /** É o turno deste jogador */
  active: boolean
  onSelect: () => void
  onPickDeck: () => void
  onOpenZone: (zone: ZoneName) => void
  /** Escolhendo alvo: clicar no campo mira no jogador */
  choosing: boolean
  /** Cartas selecionadas (de qualquer campo) */
  selection: Set<string>
  /** Retângulo arrastado no campo vazio: seleciona as cartas dentro dele (somando, com Shift/Ctrl) */
  onMarquee: (ids: string[], add: boolean) => void
  onClearSelection: () => void
  /** Cartas sacudidas agora (id → registro do log, que reinicia a animação) */
  shaking: Map<string, number>
}) {
  const t = useT()
  const { send, you, startPick } = useTable()
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const layer = useRef<HTMLDivElement>(null)
  const marqueed = useRef(false) // o clique que termina um retângulo não conta como clique no campo
  const startMarquee = (e: MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0 || choosing || (e.target as HTMLElement).closest('[data-card-id], button')) return
    e.preventDefault()
    const el = e.currentTarget
    const r = el.getBoundingClientRect()
    const x0 = e.clientX - r.left
    const y0 = e.clientY - r.top
    marqueed.current = false
    const move = (ev: globalThis.MouseEvent) => {
      const x1 = ev.clientX - r.left
      const y1 = ev.clientY - r.top
      if (Math.abs(x1 - x0) + Math.abs(y1 - y0) > 6) marqueed.current = true
      if (marqueed.current) setBox({ x0, y0, x1, y1 })
    }
    const up = (ev: globalThis.MouseEvent) => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      setBox(null)
      if (!marqueed.current) return
      const left = r.left + Math.min(x0, ev.clientX - r.left)
      const right = r.left + Math.max(x0, ev.clientX - r.left)
      const top = r.top + Math.min(y0, ev.clientY - r.top)
      const bottom = r.top + Math.max(y0, ev.clientY - r.top)
      const ids = [...el.querySelectorAll('[data-card-id]')]
        .filter((n) => {
          const c = n.getBoundingClientRect()
          return c.right > left && c.left < right && c.bottom > top && c.top < bottom
        })
        .map((n) => n.getAttribute('data-card-id')!)
      onMarquee(ids, ev.shiftKey || ev.ctrlKey || ev.metaKey)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  const large = size === 'large'
  const { boardScale, reduceMotion, showSymbols, showBoardNames, showPlaymats, manaCounter } = useTableSettings()
  // Oponente: cemitério (e exílio) em pilhas no canto do campo, com a carta de cima à mostra
  const piles = !facing && !!player?.deck
  const pileW = large ? 58 : 42
  // Campo pequeno (destaque, todos iguais): as posições são frações do campo de quem jogou, então a
  // carta encolhe na mesma proporção do campo, para não ficarem umas em cima das outras
  const [area, setArea] = useState<{ w: number; h: number } | null>(null)
  useEffect(() => {
    const el = layer.current
    if (!el || large) return
    const ro = new ResizeObserver(([e]) => setArea({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [large])
  const fit = !large && area ? Math.min(area.w / REF_BOARD.w, area.h / REF_BOARD.h) : 1
  const w = large
    ? Math.round(BOARD_CARD.large * boardScale)
    : Math.round(Math.max(SMALL_MIN, Math.min(BOARD_CARD.small, BOARD_CARD.large * fit) * boardScale))
  const h = w * CARD_RATIO
  // Cartas presas (equipamentos, auras) aparecem atrás da carta em que estão, um pouco deslocadas
  const field = player?.battlefield ?? []
  const ids = new Set(field.map((c) => c.id))
  const attached = new Map<string, FieldCard[]>()
  for (const c of field)
    if (c.attached_to && ids.has(c.attached_to))
      attached.set(c.attached_to, [...(attached.get(c.attached_to) ?? []), c])
  const hosts = field.filter((c) => !c.attached_to || !ids.has(c.attached_to))
  // Zona do comandante: quadro no canto (em cima à esquerda no seu campo; embaixo nos oponentes,
  // que aparecem espelhados), uma vaga do tamanho da carta por comandante, lado a lado
  const cmdBox = useRef<HTMLDivElement>(null)
  const cmdSlots = Math.max(1, player?.commanders ?? field.filter((c) => c.commander && c.owner === player?.id).length)
  const cmdBoxW = cmdSlots * w + (cmdSlots - 1) * CMD_PAD + CMD_PAD * 2
  const inBox = (e: { clientX: number; clientY: number }) => {
    const r = cmdBox.current?.getBoundingClientRect()
    return !!r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
  }
  const card = (c: FieldCard, host: FieldCard, k: number) => {
    // Presas: atrás da carta, um pouco para a esquerda e para cima (do ponto de vista do dono do
    // campo), sem sair do campo
    const dx = -k * w * 0.28
    const dy = k * h * 0.12 * (facing ? -1 : 1)
    // Comandante na zona dele: na vaga do quadro, não no ponto x/y
    const slot = host.slot ?? null
    const statRoom = c.stats ? (large ? 16 : 13) : 0
    const boxLeft = 4 + CMD_PAD + (slot ?? 0) * (w + CMD_PAD)
    const boxTop = 4 + CMD_LABEL + CMD_PAD
    return (
      <div
        key={c.id}
        // Mouse em cima: a carta vem para a frente das que a cobrem, com uma sombra para se destacar
        className="absolute hover:z-30 hover:drop-shadow-[0_6px_14px_rgba(0,0,0,0.85)] focus-within:z-30"
        // Campo dos oponentes espelhado: os terrenos deles ficam do lado deles, longe de você
        style={
          slot !== null && player?.deck
            ? {
                left: Math.max(0, boxLeft + dx),
                top: facing ? `${boxTop + dy}px` : `calc(100% - ${boxTop + h + CMD_STAT - dy}px)`,
              }
            : {
                left: `clamp(0px, calc((100% - ${w}px) * ${host.x} + ${dx}px), calc(100% - ${w}px))`,
                // Força/resistência fica logo abaixo da carta: na beira de baixo do campo a carta sobe
                // um pouco para ela não ser cortada pela divisória
                top: `clamp(0px, calc((100% - ${h + statRoom}px) * ${facing ? host.y : 1 - host.y} + ${dy}px), calc(100% - ${h + statRoom}px))`,
              }
        }
      >
        <div
          key={shaking.get(c.id) ?? 0}
          className={
            shaking.has(c.id)
              ? `${reduceMotion ? '' : 'animate-[card-shake_0.55s_ease-in-out_2]'} rounded-[6%] shadow-[0_0_0_2px_#e4572e,0_0_22px_rgba(228,87,46,0.75)]`
              : ''
          }
        >
          <CardView
            card={c}
            zone="battlefield"
            // Arrasta quem controla a carta (a sua, ou uma que te deram o controle)
            mine={mine && (c.controller ?? c.owner) === you}
            selected={selection.has(c.id)}
            width={w}
            tapped={c.tapped}
            tax={c.commander && c.owner === player?.id ? player.tax[c.id] : undefined}
            onDoubleClick={mine ? () => send({ type: 'tap', card: c.id }) : undefined}
          />
        </div>
        {showSymbols && <SymbolStrip symbols={c.symbols} small={!large} side={host.x > 0.92 ? 'left' : 'right'} />}
      </div>
    )
  }
  const zoneChip = (zone: 'graveyard' | 'exile', Icon: typeof Ban) =>
    player?.deck && (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onOpenZone(zone)
        }}
        title={t('View {zone} of {name}', { zone: zoneLabel(t, zone), name: player.name })}
        aria-label={t('View {zone} of {name}', { zone: zoneLabel(t, zone), name: player.name })}
        className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 transition hover:border-gold hover:text-gold ${
          player.counts[zone] ? 'border-parchment/25 text-parchment/80' : 'border-line text-parchment/40'
        }`}
      >
        <Icon className="h-3 w-3" aria-hidden />
        {player.counts[zone]}
      </button>
    )
  return (
    <DropZone
      enabled={mine && !!player?.deck}
      onCard={(card, e) => {
        // Solta no ponto onde o mouse pegou a carta, corrigindo a diferença de tamanho (mão → campo)
        // Posição relativa à camada das cartas (abaixo da faixa do nome, sem a coluna das pilhas)
        const r = (layer.current ?? e.currentTarget).getBoundingClientRect()
        const scale = w / dragInfo.w
        const x = clamp01((e.clientX - dragInfo.dx * scale - r.left) / Math.max(1, r.width - w))
        const y = clamp01((e.clientY - dragInfo.dy * scale - r.top) / Math.max(1, r.height - h))
        // Arrastou uma carta selecionada: o grupo todo anda junto
        const dragged = field.find((c) => c.id === card.id)
        if (dragged && selection.has(card.id) && selection.size > 1) {
          const places = field
            .filter((c) => selection.has(c.id) && (c.controller ?? c.owner) === you && !c.locked && !c.attached_to)
            .map((c) => ({ card: c.id, x: clamp01(c.x + x - dragged.x), y: clamp01(c.y + y - dragged.y) }))
          send({ type: 'place_many', places })
          return
        }
        // Equipamento/aura solto em cima de outra carta: já prende nela
        const host = card.attach
          ? document
              .elementsFromPoint(e.clientX, e.clientY)
              .map((el) => el.closest('[data-card-id]')?.getAttribute('data-card-id'))
              .find((id) => id && id !== card.id)
          : null
        if (host) {
          if (card.from !== 'battlefield') send({ type: 'move', card: card.id, to: 'battlefield', x, y })
          send({ type: 'attach', card: card.id, to: host })
          return
        }
        // Solto no quadro da zona do comandante: o comandante vai para a vaga dele
        send({ type: 'move', card: card.id, to: 'battlefield', x, y, ...(inBox(e) ? { slot: true } : {}) })
        // Equipamento/aura que acabou de entrar: pede a carta onde prender (Esc deixa solta)
        if (card.attach && card.from !== 'battlefield')
          startPick('attach', { id: card.id, name: card.name ?? '', image: '', back: '' })
      }}
      onMouseDown={startMarquee}
      // Clicar no campo (o seu ou o de outro jogador) mostra as zonas dele ao lado da mão e,
      // no split, traz o campo para o foco. Também limpa a seleção.
      onClick={() => {
        if (marqueed.current) {
          marqueed.current = false
          return
        }
        onClearSelection()
        onSelect()
      }}
      className={`relative min-h-0 flex-1 overflow-hidden bg-gradient-to-b to-transparent [&+&]:border-t [&+&]:border-line ${SEAT_TINT[seat - 1]} ${
        active ? 'shadow-[inset_0_0_0_2px_rgba(228,87,46,0.55)]' : ''
      } ${choosing ? 'cursor-crosshair' : mine ? '' : 'cursor-pointer'}`}
    >
      {/* Fundo do campo escolhido pelo apoiador, escurecido para as cartas continuarem legíveis */}
      {showPlaymats && player?.playmat && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-35"
          style={{ backgroundImage: `url("${player.playmat}")` }}
        />
      )}
      <span
        className={`font-display pointer-events-none absolute inset-0 grid place-items-center truncate px-4 select-none ${
          player?.supporter ? 'text-gold/[0.09]' : 'text-parchment/[0.06]'
        } ${large ? 'text-5xl xl:text-7xl' : 'text-2xl xl:text-3xl'}`}
      >
        {showBoardNames ? (player?.name ?? t('Open seat')) : ''}
      </span>
      <div className="absolute top-2 left-2 z-10 flex items-center gap-2 text-xs text-parchment/60">
        <Avatar
          seat={seat}
          player={player}
          selected={selected}
          onSelect={onSelect}
          className={large ? 'h-8 w-8 text-sm' : 'h-6 w-6 text-xs'}
        />
        {player && (
          <>
            {player.supporter && <SupporterBadge className={large ? 'h-4 w-4' : 'h-3 w-3'} />}
            {active && (
              <span className="rounded bg-gold px-1.5 py-0.5 text-[0.65rem] font-bold tracking-wide text-ink uppercase">
                {t('Turn')}
              </span>
            )}
            <span className="font-semibold">{player.life}</span>
            {player.deck && (
              <span className="hidden sm:inline" title={t('Hand') + ' · ' + t('Library')}>
                ✋ {player.counts.hand} · ▤ {player.counts.library}
                {player.poison > 0 && <span className="ml-1 text-emerald-400">☠ {player.poison}</span>}
              </span>
            )}
            {/* No campo dos oponentes, cemitério e exílio ficam em pilhas no canto (abaixo) */}
            {mine && zoneChip('graveyard', Tombstone)}
            {mine && zoneChip('exile', Ban)}
            {!mine && showPlaymats && isUploadedImage(player.playmat) && (
              <PerkImageReport url={player.playmat} label={t('Report this battlefield background')} />
            )}
            {!mine && isUploadedImage(player.sleeve_image) && (
              <PerkImageReport url={player.sleeve_image} label={t('Report these card sleeves')} />
            )}
          </>
        )}
      </div>
      {box && (
        <div
          className="pointer-events-none absolute z-20 rounded border border-sky-400 bg-sky-400/10"
          style={{
            left: Math.min(box.x0, box.x1),
            top: Math.min(box.y0, box.y1),
            width: Math.abs(box.x1 - box.x0),
            height: Math.abs(box.y1 - box.y0),
          }}
        />
      )}
      {piles && player && (
        <div className="absolute top-2 right-2 bottom-2 z-10 flex flex-col items-center justify-start gap-2">
          {/* Topo do grimório virado ("Virar o topo"): todos veem a carta de cima */}
          {player.top_revealed && player.top && <RevealedTop player={player} width={pileW} />}
          <BoardPile player={player} zone="graveyard" width={pileW} onOpen={onOpenZone} />
          {player.counts.exile > 0 && <BoardPile player={player} zone="exile" width={pileW} onOpen={onOpenZone} />}
          {manaCounter && Object.keys(player.mana).length > 0 && (
            <div className="mt-auto">
              <ManaBox player={player} mine={false} compact />
            </div>
          )}
        </div>
      )}
      {manaCounter && !piles && player?.deck && (mine || Object.keys(player.mana).length > 0) && (
        <div className={`pointer-events-none absolute right-2 z-20 ${large ? 'top-12' : 'top-9'}`}>
          <ManaBox player={player} mine={mine} compact={!large} />
        </div>
      )}
      {/* Cartas numa camada que deixa livres a faixa do nome/vida em cima e a coluna das pilhas */}
      <div
        ref={layer}
        className={`absolute bottom-0 left-0 ${large ? 'top-11' : 'top-8'}`}
        style={{ right: piles ? pileW + 16 : 0 }}
      >
        {player?.deck && (
          <div
            ref={cmdBox}
            className={`pointer-events-none absolute left-1 rounded-lg border border-dashed border-gold/30 bg-gold/[0.05] ${facing ? 'top-1' : 'bottom-1'}`}
            style={{ width: cmdBoxW, height: h + CMD_PAD * 2 + CMD_LABEL + CMD_STAT }}
          >
            <span
              className={`absolute inset-x-0 truncate px-1 text-center text-[0.55rem] leading-[14px] font-semibold tracking-wider text-gold/45 uppercase ${facing ? 'top-0' : 'bottom-0'}`}
            >
              {t('Commander')}
            </span>
          </div>
        )}
        {hosts.map((host) => [
          ...(attached.get(host.id) ?? []).map((c, i, list) => card(c, host, list.length - i)),
          card(host, host, 0),
        ])}
      </div>
      {mine && player && !player.deck && (
        <div className="absolute inset-0 grid place-items-center">
          <button
            onClick={onPickDeck}
            className="font-display rounded-md btn-ember px-6 py-3 text-xl text-ink transition hover:brightness-110"
          >
            {t('Choose your deck')}
          </button>
        </div>
      )}
    </DropZone>
  )
}

/**
 * Pilha no canto do campo de um oponente (cemitério ou exílio): a carta de cima à mostra, a
 * quantidade e o ícone da zona. Clique abre a lista; passar o mouse amplia a carta de cima.
 */
/** Grimório de um oponente com o topo virado para cima: a carta de cima e quantas restam. */
function RevealedTop({ player, width }: { player: TablePlayer; width: number }) {
  const t = useT()
  const { preview } = useTable()
  const top = player.top!
  const label = t('Top of {name}’s library (revealed)', { name: player.name })
  return (
    <div
      title={label}
      aria-label={label}
      onMouseEnter={(e) => preview(top, e.clientX)}
      onMouseLeave={() => preview(null)}
      style={{ width, height: width * CARD_RATIO }}
      className="relative shrink-0 rounded-[6%] ring-2 ring-sky-400/70"
    >
      <img
        src={smallImage(top.image)}
        alt={top.name}
        draggable={false}
        className="h-full w-full rounded-[6%] object-cover shadow-md shadow-black/60"
      />
      <span className="absolute -bottom-1.5 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-full bg-ink px-1.5 py-px text-[0.65rem] font-bold whitespace-nowrap text-sky-300 ring-1 ring-sky-400/50">
        <Eye className="h-3 w-3" aria-hidden />
        {player.counts.library}
      </span>
    </div>
  )
}

function BoardPile({
  player,
  zone,
  width,
  onOpen,
}: {
  player: TablePlayer
  zone: 'graveyard' | 'exile'
  width: number
  onOpen: (z: ZoneName) => void
}) {
  const t = useT()
  const { preview } = useTable()
  const count = player.counts[zone]
  const top = player[zone]?.at(-1)
  const Icon = zone === 'graveyard' ? Tombstone : Ban
  const label = t('View {zone} of {name}', { zone: zoneLabel(t, zone), name: player.name })
  return (
    <button
      type="button"
      disabled={!count}
      onClick={(e) => {
        e.stopPropagation()
        onOpen(zone)
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseEnter={(e) => top && preview(top, e.clientX)}
      onMouseLeave={() => preview(null)}
      title={label}
      aria-label={label}
      style={{ width, height: width * CARD_RATIO }}
      className="group relative shrink-0 rounded-[6%] border border-dashed border-parchment/20 bg-ink/40 transition enabled:hover:border-gold/70"
    >
      {top ? (
        <img
          src={cardImage(top.image, width)}
          alt={top.name}
          draggable={false}
          className={`h-full w-full rounded-[6%] object-cover shadow-md shadow-black/60 ${zone === 'exile' ? 'opacity-80 saturate-50' : ''}`}
        />
      ) : (
        <Icon className="absolute inset-0 m-auto h-1/3 w-1/3 text-parchment/25" aria-hidden />
      )}
      <span className="absolute -bottom-1.5 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-full bg-ink px-1.5 py-px text-[0.65rem] font-bold whitespace-nowrap text-parchment/90 ring-1 ring-line group-enabled:group-hover:text-gold">
        <Icon className="h-3 w-3" aria-hidden />
        {count}
      </span>
    </button>
  )
}

/** Uma zona (grimório, comando, pilha virada, exílio, cemitério): carta do topo e quantidade. */
export function ZoneTile({
  player,
  zone,
  mine,
  onOpen,
  onLibrary,
  compact = false,
}: {
  player: TablePlayer
  zone: ZoneName
  mine: boolean
  onOpen: (z: ZoneName) => void
  /** Clique no seu grimório: abre o menu do deck */
  onLibrary: (x: number, y: number) => void
  /** Só o topo da carta, com o nome da zona por cima (mão compacta) */
  compact?: boolean
}) {
  const t = useT()
  const { send } = useTable()
  const count = player.counts[zone]
  const list = zone === 'library' ? null : (player[zone as 'graveyard'] as TableCard[] | null)
  // Grimório com o topo revelado: todos veem a carta de cima
  const top = zone === 'library' ? player.top : list?.at(-1)
  const hidden = (zone === 'library' && !top) || (zone === 'facedown' && !mine)
  const canOpen = zone !== 'library' && !hidden && count > 0
  const click = (e: MouseEvent) => {
    if (zone === 'library' && mine) {
      const r = e.currentTarget.getBoundingClientRect()
      onLibrary(r.left, r.top)
    } else if (canOpen) onOpen(zone)
  }
  return (
    <DropZone
      enabled={mine && !!player.deck}
      onCard={(card) => send({ type: 'move', card: card.id, to: zone, position: 'top' })}
      className={`flex w-[4.25rem] flex-col items-center rounded-md p-0.5 ${compact ? '' : 'gap-1'}`}
    >
      <button
        onClick={click}
        onContextMenu={(e) => {
          if (zone !== 'library' || !mine) return
          e.preventDefault()
          click(e)
        }}
        disabled={!(zone === 'library' && mine) && !canOpen}
        title={zone === 'library' && mine ? t('Library options') : zoneLabel(t, zone)}
        aria-label={zone === 'library' && mine ? t('Library options') : zoneLabel(t, zone)}
        className={`relative grid w-16 place-items-center border border-dashed border-parchment/15 enabled:hover:border-gold/60 ${
          compact ? 'h-12 place-items-start overflow-hidden rounded-md' : 'h-[5.6rem] rounded-[6%]'
        }`}
      >
        {count > 0 &&
          (hidden || !top ? (
            <CardBack width={62} sleeve={player} />
          ) : (
            <img
              src={smallImage(top.image)}
              alt={top.name}
              className={`w-full rounded-[6%] object-cover ${compact ? 'object-top' : 'h-full'}`}
            />
          ))}
        {count > 0 && (
          <span
            className={`absolute rounded-full bg-ink px-1.5 text-[0.7rem] font-bold ring-1 ring-line ${
              compact ? 'top-0.5 right-0.5' : '-right-1.5 -bottom-1.5'
            }`}
          >
            {count}
          </span>
        )}
        {compact && (
          <span className="absolute inset-x-0 bottom-0 truncate bg-ink/80 px-0.5 text-center text-[0.55rem] tracking-wide text-parchment/70 uppercase">
            {zone === 'command' ? t('Command') : zone === 'facedown' ? t('Facedown') : zoneLabel(t, zone)}
          </span>
        )}
      </button>
      {!compact && (
        <span className="max-w-full truncate text-[0.62rem] tracking-wide text-parchment/50 uppercase">
          {zone === 'command' ? t('Command') : zone === 'facedown' ? t('Facedown') : zoneLabel(t, zone)}
        </span>
      )}
    </DropZone>
  )
}

/** Muitas cartas na mão: elas se sobrepõem para caber */

/** Uma linha do log, montada no idioma de quem lê. */
/**
 * Carta ampliada ao passar o mouse. Fica num componente à parte, que escuta só a prévia: passar o
 * mouse pelas cartas não redesenha a mesa inteira (com o campo cheio isso deixava tudo lento).
 * Mostra a versão mais nova da carta (ex.: uma nota escrita com o mouse em cima).
 */
export function PreviewHost({ players }: { players: TablePlayer[] | undefined }) {
  const preview = useHoverPreview()
  useEffect(() => () => setHoverPreview(null), []) // saiu da mesa: nada de prévia presa
  const live = preview
    ? ((players ?? []).flatMap((p) => p.battlefield).find((c) => c.id === preview.card.id) ?? preview.card)
    : null
  return <CardPreviewPanel card={live} side={preview?.side ?? 'right'} />
}
