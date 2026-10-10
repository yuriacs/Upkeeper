// Sistema oficial de brackets de Commander (Wizards). O site estima o bracket *mínimo* pela lista.
export const BRACKET_NAMES: Record<number, string> = {
  1: 'Exhibition',
  2: 'Core',
  3: 'Upgraded',
  4: 'Optimized',
  5: 'cEDH',
}

// Texto em inglês: traduzido com t() na renderização
export const BRACKET_HINTS: Record<number, string> = {
  2: 'No Game Changers, no 2-card combos and no mass land denial. Can be a 1 (Exhibition) if the table agrees on a more thematic game.',
  3: 'Up to 3 Game Changers and/or 2-card combos (which shouldn\'t go off before turn 6).',
  4: 'More than 3 Game Changers, mass land denial or chained extra turns. Can be a 5 (cEDH) if it\'s built to compete.',
}

export const SPELLBOOK_URL = 'https://commanderspellbook.com'
export const BRACKETS_ARTICLE_URL =
  'https://magic.wizards.com/en/news/announcements/commander-brackets-beta-update-february-9-2026'
