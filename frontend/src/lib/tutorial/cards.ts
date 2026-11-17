/*
 * Cartas da partida tutorial (/tutorial): sempre as mesmas, na mesma ordem. Cartas simples, sem
 * habilidades, para a aula falar só do básico. Imagens fixas do Scryfall, em inglês e na
 * impressão em português da mesma edição.
 */

export type L = { en: string; pt: string }
/** O texto no idioma escolhido */
export const pick = (text: L, lang: 'en' | 'pt') => text[lang]
export type CardKind = 'land' | 'creature' | 'instant' | 'sorcery'
export type ManaColor = 'G' | 'R' | 'B'

export type CardDef = {
  name: L
  kind: CardKind
  /** Custo de mana no formato do Scryfall ("{1}{G}"); terrenos: "" */
  cost: string
  power?: number
  toughness?: number
  /** Terreno: a cor da mana que ele gera */
  makes?: ManaColor
  /** Linha de tipo e texto da carta (para a carta ampliada) */
  type: L
  text?: L
  img: L
}

const sf = (path: string) => `https://cards.scryfall.io/normal/front/${path}`

export const CARD_DEFS = {
  forest: {
    name: { en: 'Forest', pt: 'Floresta' },
    kind: 'land',
    cost: '',
    makes: 'G',
    type: { en: 'Basic Land — Forest', pt: 'Terreno Básico — Floresta' },
    text: { en: '{T}: Add {G}.', pt: '{T}: Adicione {G}.' },
    img: {
      en: sf('3/2/3279314f-d639-4489-b2ab-3621bb3ca64b.jpg?1783930641'),
      pt: sf('6/4/64bc2068-9555-4e1c-8e19-ab4953505a8f.jpg?1782904181'),
    },
  },
  mountain: {
    name: { en: 'Mountain', pt: 'Montanha' },
    kind: 'land',
    cost: '',
    makes: 'R',
    type: { en: 'Basic Land — Mountain', pt: 'Terreno Básico — Montanha' },
    text: { en: '{T}: Add {R}.', pt: '{T}: Adicione {R}.' },
    img: {
      en: sf('b/9/b92c8925-ecfc-4ece-b83a-f12e98a938ab.jpg?1783930645'),
      pt: sf('5/b/5b3aef81-aff8-4517-a3fc-1774bc0585fa.jpg?1782904198'),
    },
  },
  swamp: {
    name: { en: 'Swamp', pt: 'Pântano' },
    kind: 'land',
    cost: '',
    makes: 'B',
    type: { en: 'Basic Land — Swamp', pt: 'Terreno Básico — Pântano' },
    text: { en: '{T}: Add {B}.', pt: '{T}: Adicione {B}.' },
    img: {
      en: sf('3/0/30b3d647-3546-4ade-b395-f2370750a7a6.jpg?1783930643'),
      pt: sf('b/0/b06726c8-726f-4058-a06b-46cde19c8378.jpg?1782904225'),
    },
  },
  bears: {
    name: { en: 'Grizzly Bears', pt: 'Ursos Cinzentos' },
    kind: 'creature',
    cost: '{1}{G}',
    power: 2,
    toughness: 2,
    type: { en: 'Creature — Bear', pt: 'Criatura — Urso' },
    img: {
      en: sf('4/0/409f9b88-f03e-40b6-9883-68c14c37c0de.jpg?1783943001'),
      pt: sf('7/f/7f5748d7-dd81-4231-8e80-b5995a3bbe2a.jpg?1783010321'),
    },
  },
  courser: {
    name: { en: 'Centaur Courser', pt: 'Centaura-caçadora' },
    kind: 'creature',
    cost: '{2}{G}',
    power: 3,
    toughness: 3,
    type: { en: 'Creature — Centaur Warrior', pt: 'Criatura — Centauro Guerreiro' },
    img: {
      en: sf('e/8/e8b67ee8-3189-4426-8b1a-b540267768fd.jpg?1783932966'),
      pt: sf('9/9/9977adb4-75f4-44ac-9e81-61a2c15bb799.jpg?1782917112'),
    },
  },
  shock: {
    name: { en: 'Shock', pt: 'Choque' },
    kind: 'instant',
    cost: '{R}',
    type: { en: 'Instant', pt: 'Mágica Instantânea' },
    text: { en: 'Shock deals 2 damage to any target.', pt: 'Choque causa 2 pontos de dano a qualquer alvo.' },
    img: {
      en: sf('5/9/59fa8e8d-bcb8-47bf-b71a-df11c8d0f2c9.jpg?1783930686'),
      pt: sf('b/2/b253a43f-22fe-4c7e-a1d1-bee388539d16.jpg?1782905017'),
    },
  },
  growth: {
    name: { en: 'Giant Growth', pt: 'Crescimento Desenfreado' },
    kind: 'instant',
    cost: '{G}',
    type: { en: 'Instant', pt: 'Mágica Instantânea' },
    text: {
      en: 'Target creature gets +3/+3 until end of turn.',
      pt: 'A criatura alvo recebe +3/+3 até o final do turno.',
    },
    img: {
      en: sf('e/6/e6b32578-a074-4a46-b742-84b974748903.jpg?1783939905'),
      pt: sf('5/2/52be6419-265e-4f2a-b6b6-c70486bdacfe.jpg?1782976208'),
    },
  },
  wurm: {
    name: { en: 'Craw Wurm', pt: 'Serpente Terrestre de Craw' },
    kind: 'creature',
    cost: '{4}{G}{G}',
    power: 6,
    toughness: 4,
    type: { en: 'Creature — Wurm', pt: 'Criatura — Vorme' },
    img: {
      en: sf('d/a/da6b8e11-b799-4235-bd8f-c4b55946c769.jpg?1783943004'),
      pt: sf('0/9/09c01e73-81e7-4a1a-8e60-6ce3163d09c4.jpg?1783010378'),
    },
  },
  giant: {
    name: { en: 'Hill Giant', pt: 'Gigante da Colina' },
    kind: 'creature',
    cost: '{3}{R}',
    power: 3,
    toughness: 3,
    type: { en: 'Creature — Giant', pt: 'Criatura — Gigante' },
    img: {
      en: sf('1/4/14c2be6a-9ca6-4d3a-8dd0-db4ea40799f8.jpg?1783943018'),
      pt: sf('a/8/a875230b-5b67-46ef-a86f-24623aaf33bb.jpg?1783010624'),
    },
  },
  axe: {
    name: { en: 'Lava Axe', pt: 'Machado de Lava' },
    kind: 'sorcery',
    cost: '{4}{R}',
    type: { en: 'Sorcery', pt: 'Feitiço' },
    text: {
      en: 'Lava Axe deals 5 damage to target player or planeswalker.',
      pt: 'Machado de Lava causa 5 pontos de dano ao jogador ou planeswalker alvo.',
    },
    img: {
      en: sf('c/3/c3dab325-8f4f-4288-9f3f-960e52b4335b.jpg?1783934548'),
      pt: sf('b/a/ba180133-20e0-4bae-aeda-62a762e744e4.jpg?1782930470'),
    },
  },
  corpse: {
    name: { en: 'Walking Corpse', pt: 'Cadáver Ambulante' },
    kind: 'creature',
    cost: '{1}{B}',
    power: 2,
    toughness: 2,
    type: { en: 'Creature — Zombie', pt: 'Criatura — Zumbi' },
    img: {
      en: sf('0/5/053b59b4-a22c-4228-aadc-ae9da6bb465e.jpg?1783930696'),
      pt: sf('0/2/027088dc-ce3b-47f4-a799-28d9233516f6.jpg?1782905246'),
    },
  },
  zombies: {
    name: { en: 'Scathe Zombies', pt: 'Zumbis de Scathe' },
    kind: 'creature',
    cost: '{2}{B}',
    power: 2,
    toughness: 2,
    type: { en: 'Creature — Zombie', pt: 'Criatura — Zumbi' },
    img: {
      en: sf('0/3/037cbf71-1199-4457-9b09-f66e7cb294d5.jpg?1783943028'),
      pt: sf('4/b/4be3950a-5e72-4c22-96e9-6eee1af70a2c.jpg?1783010814'),
    },
  },
} satisfies Record<string, CardDef>

export type CardKey = keyof typeof CARD_DEFS

/** Cada carta da partida (id → qual carta). Os ids aparecem no roteiro (script.ts). */
export const CARDS: Record<string, CardKey> = {
  // Primeira mão (sem terrenos: vai para o mulligan)
  bears_a: 'bears',
  courser_a: 'courser',
  giant_a: 'giant',
  wurm_a: 'wurm',
  shock_a: 'shock',
  growth_a: 'growth',
  axe_a: 'axe',
  // Mão depois do mulligan
  forest1: 'forest',
  forest2: 'forest',
  mountain1: 'mountain',
  bears: 'bears',
  courser: 'courser',
  shock: 'shock',
  wurm: 'wurm',
  // Compras dos turnos 2 a 5
  growth: 'growth',
  mountain2: 'mountain',
  forest3: 'forest',
  giant: 'giant',
  // Upkeeper
  swamp1: 'swamp',
  swamp2: 'swamp',
  swamp3: 'swamp',
  swamp4: 'swamp',
  corpse: 'corpse',
  zombies: 'zombies',
}

export const def = (id: string): CardDef => CARD_DEFS[CARDS[id]]
