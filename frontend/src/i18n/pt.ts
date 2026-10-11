import { account } from './pt/account'
import { content } from './pt/content'
import { deck } from './pt/deck'
import { room } from './pt/room'
import { shell } from './pt/shell'
import { table } from './pt/table'

/** Português: texto em inglês → tradução. Dividido por área do site. */
export const pt: Record<string, string> = { ...shell, ...room, ...deck, ...account, ...content, ...table }
