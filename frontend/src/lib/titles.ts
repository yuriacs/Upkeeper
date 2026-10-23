/*
 * Títulos de Fundador (abaixo do nome no perfil): lista fixa, sem texto livre. As chaves são as
 * mesmas do servidor (accounts/supporter.py, TITLES); o texto passa pelo t() das traduções.
 */

export const TITLES: { key: string; label: string }[] = [
  { key: 'token_master', label: 'Token Master' },
  { key: 'mulligan_legend', label: 'Mulligan Legend' },
  { key: 'table_politician', label: 'Table Politician' },
  { key: 'public_enemy', label: 'Public Enemy' },
  { key: 'combo_master', label: 'Combo Master' },
  { key: 'group_hug', label: 'Group Hug' },
  { key: 'pillow_fort', label: 'Pillow Fort' },
  { key: 'topdeck_luck', label: 'Topdeck Luck' },
  { key: 'kingmaker', label: 'Kingmaker' },
  { key: 'precon_hero', label: 'Precon Hero' },
  { key: 'salt_mine', label: 'Salt Mine' },
  { key: 'agent_of_chaos', label: 'Agent of Chaos' },
]

const BY_KEY = new Map(TITLES.map((title) => [title.key, title.label]))

/** Texto (em inglês, para o t()) de uma chave de título; vazio se não houver */
export const titleLabel = (key: string | null | undefined) => BY_KEY.get(key ?? '') ?? ''
