/*
 * Texto de cada evento do registro da mesa ("ana moveu Island da mão para o cemitério"). Fica
 * fora da página da mesa para a página de rever a partida usar sem carregar a mesa inteira.
 */
import type { LogItem } from '../../hooks/useTableSocket'
import { achievementName } from '../../lib/achievements'
import { fmtClock } from '../../lib/duration'
import { helperByName, helperLabel } from './helpers'
import { symbolLabel, zoneLabel } from './tableUtils'

export type T = (s: string, v?: Record<string, string | number>) => string

/** A ação como frase sem o nome de quem fez ("moveu Island da mão para o cemitério"), para o desfazer. */
export function actionText(t: T, e: LogItem): string {
  if (e.kind === 'action') {
    const silent: Record<string, string> = {
      move: t('moved a card on the battlefield'),
      place_many: t('moved cards on the battlefield'),
      arrange: t('arranged their battlefield'),
      lock: t('locked or unlocked a card'),
      toggle_stats: t('changed a power/toughness counter'),
      reorder_top: t('reordered the top of the library'),
    }
    return silent[e.text ?? ''] ?? t('their last action')
  }
  const full = logText(t, e)
  // Tira "ana " / "ana: " do começo (o nome já está na frase de quem desfez)
  return full.startsWith(`${e.who}: `)
    ? full.slice(e.who.length + 2)
    : full.startsWith(`${e.who} `)
      ? full.slice(e.who.length + 1)
      : full
}

/** Resumo do atalho de carta no log */
function actShort(t: T, act: string, n: number, how?: string): string {
  if (act === 'target')
    return (
      {
        destroy: t('destroy'),
        exile: t('exile'),
        bounce: t('return to hand'),
        tap: t('tap the target'),
        untap: t('untap the target'),
        counters: t('{n} counter(s)', { n }),
      }[how ?? ''] ?? act
    )
  return (
    {
      damage: t('{n} damage', { n }),
      regrow: t('return from the graveyard'),
      look: t('look at the top {n}', { n }),
      search: t('search the library'),
      tokens: t('{n} token(s)', { n }),
      counters: t('+1/+1 counters on their creatures'),
      draw: t('draw {n}', { n }),
      mill: t('mill {n}', { n }),
      scry: t('scry {n}', { n }),
      surveil: t('surveil {n}', { n }),
      gain: t('gain {n} life', { n }),
      drain: t('each opponent loses {n} life', { n }),
      wipe: t('board wipe'),
    }[act] ?? act
  )
}

export function logText(t: T, e: LogItem): string {
  const who = e.who
  // Ação na carta de outro jogador: "ana virou Sol Ring de beto"
  const named = e.card ?? t('a card')
  const card = e.owner && e.owner !== who ? t('{owner}’s {card}', { owner: e.owner, card: named }) : named
  switch (e.kind) {
    case 'joined':
      return t('{who} sat down', { who })
    case 'end_request':
      return e.winner
        ? t('{who} asked to end the game: {winner} won', { who, winner: e.winner })
        : t('{who} asked to end the game with no winner', { who })
    case 'end_cancel':
      return t('{who} gave up ending the game', { who })
    case 'close_request':
      return t('{who} asked to close the table', { who })
    case 'close_cancel':
      return t('{who} gave up closing the table', { who })
    case 'close_rejected':
      return t('{who} wants to keep playing (the table stays open)', { who })
    case 'close_confirmed':
      return t('{who} confirmed closing the table', { who })
    case 'end_rejected':
      return t('{who} did not confirm the end of the game', { who })
    case 'end_confirmed':
      return t('{who} confirmed the end of the game', { who })
    case 'abandoned':
      return t('{who} left the table (the seat is free)', { who })
    case 'restored':
      return t('{who} restored the table: the game continues where it stopped', { who })
    case 'deck':
      return t('{who} loaded {deck} ({n} cards)', { who, deck: e.deck ?? '', n: e.n ?? 0 })
    case 'draw':
      return e.n === 1 ? t('{who} drew a card', { who }) : t('{who} drew {n} cards', { who, n: e.n ?? 0 })
    case 'move':
      if (e.to === 'library')
        return e.position === 'bottom'
          ? t('{who} put {card} on the bottom of the library', { who, card })
          : t('{who} put {card} on top of the library', { who, card })
      return t('{who} moved {card} from {from} to {to}', {
        who,
        card,
        from: zoneLabel(t, String(e.frm)),
        to: zoneLabel(t, String(e.to)),
      })
    case 'tap':
      return t('{who} tapped {card}', { who, card })
    case 'untap':
      return t('{who} untapped {card}', { who, card })
    case 'untap_all':
      return t('{who} untapped everything', { who })
    case 'arrange':
      return t('{who} arranged their battlefield in rows', { who })
    case 'shuffle':
      return t('{who} shuffled the library', { who })
    case 'mulligan':
      return t('{who} took a mulligan', { who })
    case 'restart':
      return t('{who} restarted the game', { who })
    case 'life':
      return t('{who}: life {from} → {to}', { who, from: e.frm ?? '', to: e.to ?? '' })
    case 'counter':
      return t('{who}: {card} now has {n} {counter} counter(s)', { who, card, n: e.n ?? 0, counter: e.counter ?? '' })
    case 'tax':
      return t('{who}: commander tax for {card} is now +{n}', { who, card, n: e.n ?? 0 })
    case 'cmd_damage':
      return t('{who} has taken {n} commander damage from {source}', { who, n: e.n ?? 0, source: e.source ?? '' })
    case 'poison':
      return t('{who} has {n} poison counter(s)', { who, n: e.n ?? 0 })
    case 'search':
      return t('{who} is searching their library', { who })
    case 'card_action':
      if (typeof e.to === 'string' && e.to)
        return t('{who} used {card}: {action} → {target}', {
          who,
          card,
          action: actShort(t, e.act ?? '', e.n ?? 0, e.do),
          target: e.to,
        })
      return t('{who} used {card}: {action}', { who, card, action: actShort(t, e.act ?? '', e.n ?? 0, e.do) })
    case 'regrow_put':
      return t('{who} returned {cards} from the graveyard', { who, cards: e.text ?? '' })
    case 'search_put':
      return e.text
        ? t('{who} found {n} card(s) ({cards}) and shuffled', { who, n: e.n ?? 0, cards: e.text })
        : t('{who} found {n} card(s) and shuffled', { who, n: e.n ?? 0 })
    case 'look':
      return t('{who} looked at the top {n} card(s) of their library', { who, n: e.n ?? 0 })
    case 'reveal':
      if (e.cards && e.cards.length > 1)
        return t('{who} revealed the top {n} cards: {cards}', {
          who,
          n: e.cards.length,
          cards: e.cards.map((c) => c.name).join(', '),
        })
      return t('{who} revealed {card}', { who, card })
    case 'draw_to': {
      const where = {
        graveyard: t('to the graveyard'),
        exile: t('to exile'),
        facedown: t('to the facedown pile'),
        hand: t('to their hand'),
        battlefield: t('onto the battlefield'),
        battlefield_down: t('onto the battlefield face down'),
      }[String(e.to)]
      const what = e.text ? ` (${e.text})` : ''
      return e.position === 'bottom'
        ? t('{who} put {n} card(s) from the bottom of the library {where}', { who, n: e.n ?? 0, where: where ?? '' }) +
            what
        : t('{who} put {n} card(s) from the top of the library {where}', { who, n: e.n ?? 0, where: where ?? '' }) +
            what
    }
    case 'top_revealed':
      return t('{who} is playing with the top of the library revealed', { who })
    case 'top_hidden':
      return t('{who} stopped revealing the top of the library', { who })
    case 'scoop':
      return t('{who} scooped: all their cards went back to the library', { who })
    case 'shake':
      return t('{who} shook {card}', { who, card })
    case 'invert':
      return t('{who} turned {card} upside down', { who, card })
    case 'uninvert':
      return t('{who} turned {card} right side up', { who, card })
    case 'highlight':
      return t('{who} highlighted {card}', { who, card })
    case 'note':
      return e.text
        ? t('{who} wrote on {card}: “{text}”', { who, card, text: e.text })
        : t('{who} removed the note from {card}', { who, card })
    case 'symbol':
      return t('{who} marked {card}: {symbol}', { who, card, symbol: symbolLabel(t, e.text ?? '') })
    case 'face_down':
      return t('{who} turned {card} face down', { who, card })
    case 'face_up':
      return t('{who} turned {card} face up', { who, card })
    case 'flip':
      return t('{who} turned {card} to its other face', { who, card })
    case 'control':
      return t('{who} gave control of {card} to {to}', { who, card, to: e.to ?? '' })
    case 'helper': {
      const h = helperByName(e.card ?? '')
      const name = h ? helperLabel(t, h.key) : (e.card ?? '')
      return e.owner
        ? t('{who} took {card} from {owner}', { who, card: name, owner: e.owner })
        : t('{who} put {card} on the battlefield', { who, card: name })
    }
    case 'control_ask':
      return t('{who} asked {to} for control of {card}', { who, card, to: e.to ?? '' })
    case 'control_no':
      return t('{who} kept control of {card} (asked by {to})', { who, card, to: e.to ?? '' })
    case 'show_hand':
      if (e.spectators) return t('{who} is showing their hand to spectators', { who })
      return e.target
        ? t('{who} is showing their hand to {target}', { who, target: e.target })
        : t('{who} is showing their hand to everyone', { who })
    case 'hide_hand':
      if (e.spectators) return t('{who} stopped showing their hand to spectators', { who })
      return e.target
        ? t('{who} stopped showing their hand to {target}', { who, target: e.target })
        : t('{who} stopped showing their hand', { who })
    case 'afk':
      return e.target ? t('{who} marked {target} as away', { who, target: e.target }) : t('{who} is away', { who })
    case 'back':
      return e.target ? t('{who} marked {target} as back', { who, target: e.target }) : t('{who} is back', { who })
    case 'attach':
      return t('{who} attached {card} to {to}', { who, card, to: e.to ?? t('a card') })
    case 'detach':
      return t('{who} detached {card}', { who, card })
    case 'tap_many':
      return t('{who} tapped {n} cards', { who, n: e.n ?? 0 })
    case 'untap_many':
      return t('{who} untapped {n} cards', { who, n: e.n ?? 0 })
    case 'move_many':
      return (
        t('{who} moved {n} cards to {to}', {
          who,
          n: e.n ?? 0,
          to:
            e.to === 'library'
              ? e.position === 'bottom'
                ? t('Bottom of library')
                : t('Top of library')
              : zoneLabel(t, String(e.to)),
        }) + (e.text ? ` (${e.text})` : '')
      )
    case 'target': {
      const target =
        e.to_owner && e.to_owner !== who && e.to_ref
          ? t('{owner}’s {card}', { owner: e.to_owner, card: e.to ?? t('a card') })
          : (e.to ?? t('a card'))
      return t('{who}: {card} targets {target}', { who, card, target })
    }
    case 'token':
      return t('{who} created a {card} token', { who, card })
    case 'clone':
      return t('{who} created a token copy of {card}', { who, card })
    case 'token_gone':
      return t('{who}: the {card} token left the battlefield', { who, card })
    case 'turn':
      return e.n === 1 && e.next === who
        ? t('{who} started the game (turn 1)', { who })
        : e.took != null
          ? t('{who} passed the turn to {next} (turn {n}) after {time}', {
              who,
              next: e.next ?? '',
              n: e.n ?? 0,
              time: fmtClock(e.took),
            })
          : t('{who} passed the turn to {next} (turn {n})', { who, next: e.next ?? '', n: e.n ?? 0 })
    case 'stat':
      return t('{who}: {card} is now {p}/{t}', { who, card, p: e.p ?? 0, t: e.t ?? 0 })
    case 'game_over':
      return e.winner
        ? t('{who} ended the game: {winner} won!', { who, winner: e.winner })
        : t('{who} ended the game with no winner', { who })
    case 'new_game':
      return t('{who} started a new game', { who })
    case 'signal':
      return e.what === 'alert' ? t('{who}: Alert! I have a response', { who }) : t('{who}: No response', { who })
    case 'achievement':
      return t('{who} unlocked the achievement {name}', { who, name: achievementName(t, e.key ?? '') })
    case 'roll':
      return e.sides === 2
        ? t('{who} flipped a coin: {result}', { who, result: e.n === 1 ? t('heads') : t('tails') })
        : t('{who} rolled a d{sides}: {n}', { who, sides: e.sides ?? 0, n: e.n ?? 0 })
    case 'undo':
      return t('{who} undid: {action}', { who, action: e.undone ? actionText(t, e.undone) : t('their last action') })
    case 'rewind':
      return t('{who} took the table back to: {action}', {
        who,
        action: e.undone ? logText(t, e.undone) : t('an earlier moment'),
      })
    case 'undo_rejected':
      return t('{who} declined the undo requested by {owner}', { who, owner: e.owner ?? '' })
    case 'undo_failed':
      return t("Couldn't undo {action}: the table changed since then", {
        action: e.undone ? actionText(t, e.undone) : t('the last action'),
      })
    case 'action':
      return actionText(t, e)
    default:
      return who
  }
}
