/* Textos comuns dos torneios (lista, página do torneio e mesa da partida): backend tournaments/ */
import type { TournamentKind, TournamentStatus } from './types'

type T = (s: string, v?: Record<string, string | number>) => string

export const kindLabel = (t: T, kind: TournamentKind, teamSize: number) =>
  kind === 'league' ? t('League (pods of 4)') : teamSize === 2 ? t('Bracket 2v2') : t('Bracket 1v1')

export const statusLabel = (t: T, status: TournamentStatus, round: number) =>
  status === 'open' ? t('Sign-up open') : status === 'running' ? t('Round {n}', { n: round }) : t('Finished')

/** Nome da rodada da chave: final, semifinal, quartas; antes disso, "Rodada n" */
export function roundName(t: T, round: number, rounds: number) {
  const left = rounds - round
  if (left === 0) return t('Final')
  if (left === 1) return t('Semifinals')
  if (left === 2) return t('Quarterfinals')
  return t('Round {n}', { n: round })
}

/** Colocação: 1º, 2º, 3º, 4º */
export function placeLabel(t: T, n: number) {
  return [t('1st'), t('2nd'), t('3rd')][n - 1] ?? t('{n}th', { n })
}

/** Erros da API de torneios (o servidor manda um código) */
export function tournamentError(t: T, code: string) {
  const messages: Record<string, string> = {
    name_required: t('Give the tournament a name.'),
    bad_rounds: t('Choose how many rounds the league has.'),
    too_many: t('You already organize 3 tournaments that haven’t finished.'),
    not_open: t('Sign-up for this tournament is closed.'),
    friends_only: t('Only friends of the organizer can sign up.'),
    already_in: t('You are already signed up.'),
    full: t('The tournament is full.'),
    league_players: t('A league needs 3, 4, 6 or more players (5 don’t fit pods of 3 or 4).'),
    pairs_players: t('2v2 needs an even number of players, at least 4.'),
    bracket_players: t('A bracket needs at least 2 players.'),
    bad_result: t('That result doesn’t match the players of the match.'),
    not_ready: t('This match doesn’t have both sides yet.'),
    locked: t('The next match already has a result: this one can no longer change.'),
    not_organizer: t('Only the organizer can do that.'),
  }
  return messages[code] ?? code
}
