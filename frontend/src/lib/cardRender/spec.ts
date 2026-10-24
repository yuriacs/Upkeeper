/*
 * Uma carta desenhada no site (ficha personalizada hoje; um criador de cartas depois): tudo o que
 * o desenho precisa saber, sem a imagem da arte (que vem à parte, como ImageBitmap).
 */

/** Tamanho lógico da carta (o mesmo das imagens "normal" do Scryfall); o desenho sai em 2× */
export const CARD_W = 488
export const CARD_H = 680
export const RENDER_SCALE = 2

export const CARD_COLORS = ['W', 'U', 'B', 'R', 'G'] as const
export type CardColor = (typeof CARD_COLORS)[number]

/**
 * Enquadramento da arte: `zoom` 1 = cobre o espaço da arte sem sobrar borda; `x`/`y` de -1 a 1
 * escolhem que parte da imagem aparece quando ela é maior que o espaço (0 = centro).
 */
export type ArtFrame = { zoom: number; x: number; y: number }
export const MAX_ZOOM = 4

export type CardSpec = {
  /** "token": nome no centro e "Token" na linha de tipo; "card": nome à esquerda e custo de mana */
  layout: 'token' | 'card'
  name: string
  /** Custo de mana ("{2}{U}{U}"), só no layout "card" */
  manaCost: string
  /** Linha de tipo (nas fichas sem o "Token", que o desenho acrescenta) */
  type: string
  /** Vazio = incolor (moldura de artefato), duas ou mais = dourada */
  colors: CardColor[]
  /** Texto de regras: {T}, {W}, {2}, {W/U}... viram símbolos; (texto de lembrete) sai em itálico */
  text: string
  /** Texto de ambientação, em itálico abaixo das regras */
  flavor: string
  power: string
  toughness: string
  /** Ilustrador (rodapé) */
  artist: string
  /** Tamanho do texto da caixa: 1 = automático (diminui até caber) */
  fontScale: number
  art: ArtFrame
}

export const CENTERED_ART: ArtFrame = { zoom: 1, x: 0, y: 0 }

export const EMPTY_TOKEN: CardSpec = {
  layout: 'token',
  name: '',
  manaCost: '',
  type: 'Creature — ',
  colors: [],
  text: '',
  flavor: '',
  power: '1',
  toughness: '1',
  artist: '',
  fontScale: 1,
  art: CENTERED_ART,
}
