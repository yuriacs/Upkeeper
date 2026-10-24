import { account } from './pt/account'
import { content } from './pt/content'
import { deck } from './pt/deck'
import { room } from './pt/room'
import { shell } from './pt/shell'
import { tableShared } from './pt/tableShared'
import { tournament } from './pt/tournament'

/**
 * Português: texto em inglês → tradução. Dividido por área do site. O da mesa virtual (pt/table.ts,
 * o maior) não vem no pacote principal: entra com a página da mesa (i18n/ptTable.ts, via addPt).
 */
export const pt: Record<string, string> = { ...shell, ...room, ...deck, ...account, ...content, ...tableShared, ...tournament }

/** Junta as traduções de uma parte do site que carrega depois (a mesa virtual) */
export function addPt(dict: Record<string, string>) {
  Object.assign(pt, dict)
}
