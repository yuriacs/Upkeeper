/*
 * O cálculo do rating do Ranking, igual ao do servidor (backend/decks/services/ratings.py), para a
 * página que explica como ele funciona (exemplos e simulador). Mudou lá: mude aqui.
 */

export const START_RATING = 1500
export const K = 32
/** Partidas para aparecer no quadro do Rating */
export const RATED_MIN = 5
/** Partidas para entrar nos quadros de taxa de vitória dos decks */
export const MIN_GAMES = 3
/** Vitórias no mês para virar campeão da temporada */
export const SEASON_MIN_WINS = 3

/** Chance de `a` ganhar de `b` num duelo, pela diferença de rating (0 a 1) */
export const winChance = (a: number, b: number) => 1 / (1 + 10 ** ((b - a) / 400))

/**
 * O que muda numa partida em que `winner` ganhou de todos os `losers`: cada duelo vale K dividido
 * pelo número de adversários, vezes a "surpresa" (1 − a chance que o vencedor tinha).
 */
export function playGame(winner: number, losers: number[]) {
  const weight = K / losers.length
  const duels = losers.map((loser) => weight * (1 - winChance(winner, loser)))
  return { gain: duels.reduce((a, b) => a + b, 0), losses: duels.map((d) => -d), weight }
}
