// Sistema oficial de brackets de Commander (Wizards). O site estima o bracket *mínimo* pela lista.
export const BRACKET_NAMES: Record<number, string> = {
  1: 'Exhibition',
  2: 'Core',
  3: 'Upgraded',
  4: 'Optimized',
  5: 'cEDH',
}

export const BRACKET_HINTS: Record<number, string> = {
  2: 'Sem Game Changers, sem combos de 2 cartas e sem destruição de terrenos em massa. Pode ser 1 (Exhibition) se a mesa combinar um jogo mais temático.',
  3: 'Até 3 Game Changers e/ou combos de 2 cartas (que não devem sair antes do turno 6).',
  4: 'Mais de 3 Game Changers, destruição de terrenos em massa ou turnos extras em sequência. Pode ser 5 (cEDH) se for montado para competir.',
}

export const SPELLBOOK_URL = 'https://commanderspellbook.com'
export const BRACKETS_ARTICLE_URL =
  'https://magic.wizards.com/en/news/announcements/commander-brackets-beta-update-february-9-2026'
