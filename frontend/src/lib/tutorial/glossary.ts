import type { L } from './cards'

/** Termos que o tutorial ensina; aparecem em "O que você aprendeu" conforme a aula avança */
export const TERMS = {
  life: {
    name: { en: 'Life', pt: 'Pontos de vida' },
    text: {
      en: '20 in a one-on-one game, 40 in Commander. Whoever reaches 0 loses.',
      pt: '20 numa partida 1 contra 1, 40 no Commander. Quem chega a 0 perde.',
    },
  },
  library: {
    name: { en: 'Library', pt: 'Grimório' },
    text: {
      en: 'Your deck, shuffled and face down. You draw from the top.',
      pt: 'O seu deck, embaralhado e virado para baixo. Você compra do topo.',
    },
  },
  hand: {
    name: { en: 'Hand', pt: 'Mão' },
    text: {
      en: 'The cards you can play. Only you see them. You start with 7.',
      pt: 'As cartas que você pode jogar. Só você vê. Você começa com 7.',
    },
  },
  land: {
    name: { en: 'Land', pt: 'Terreno' },
    text: {
      en: 'Makes mana. You can play one land per turn, during your main phase.',
      pt: 'Gera mana. Você pode jogar um terreno por turno, na sua fase principal.',
    },
  },
  mulligan: {
    name: { en: 'Mulligan', pt: 'Mulligan' },
    text: {
      en: 'Bad opening hand? Shuffle it back and draw 7 new cards, then put 1 on the bottom for each mulligan. In Commander the first one is free.',
      pt: 'Mão inicial ruim? Embaralhe de volta e compre 7 novas; depois coloque 1 carta no fundo para cada mulligan. No Commander o primeiro é de graça.',
    },
  },
  phases: {
    name: { en: 'Turn phases', pt: 'Fases do turno' },
    text: {
      en: 'Untap, upkeep, draw, main phase, combat, second main phase and end. Always in this order.',
      pt: 'Desvirar, manutenção, compra, fase principal, combate, segunda fase principal e final. Sempre nessa ordem.',
    },
  },
  battlefield: {
    name: { en: 'Battlefield', pt: 'Campo de batalha' },
    text: {
      en: 'The area between the players, where permanents stay.',
      pt: 'A área entre os jogadores, onde ficam as permanentes.',
    },
  },
  permanent: {
    name: { en: 'Permanent', pt: 'Permanente' },
    text: {
      en: 'A card that stays on the battlefield after it is played: lands, creatures, artifacts, enchantments and planeswalkers.',
      pt: 'Carta que fica no campo depois de jogada: terrenos, criaturas, artefatos, encantamentos e planeswalkers.',
    },
  },
  untap: {
    name: { en: 'Untap', pt: 'Desvirar' },
    text: {
      en: 'At the start of your turn, everything you tapped goes back upright, ready to be used again.',
      pt: 'No começo do seu turno, tudo o que você virou volta ao normal, pronto para usar de novo.',
    },
  },
  upkeep: {
    name: { en: 'Upkeep', pt: 'Manutenção' },
    text: {
      en: 'Right after untapping. Some cards do things "at the beginning of your upkeep".',
      pt: 'Logo depois de desvirar. Algumas cartas fazem coisas "no início da sua manutenção".',
    },
  },
  draw: {
    name: { en: 'Draw', pt: 'Compra' },
    text: {
      en: 'Each turn you draw the top card of your library. In a 1v1 game, whoever goes first skips the draw on turn 1.',
      pt: 'Todo turno você compra a carta do topo do grimório. Num 1 contra 1, quem começa não compra no turno 1.',
    },
  },
  cost: {
    name: { en: 'Mana cost', pt: 'Custo de mana' },
    text: {
      en: 'In the top corner of the card. Colored symbols need mana of that color; the number is generic mana, of any color.',
      pt: 'No canto de cima da carta. Os símbolos coloridos pedem mana daquela cor; o número é mana genérica, de qualquer cor.',
    },
  },
  tap: {
    name: { en: 'Tap', pt: 'Virar' },
    text: {
      en: 'Turning a card sideways to use it. A tapped land has made its mana; a tapped creature has attacked.',
      pt: 'Girar a carta de lado para usá-la. Terreno virado já gerou a mana; criatura virada já atacou.',
    },
  },
  mana: {
    name: { en: 'Mana pool', pt: 'Reserva de mana' },
    text: {
      en: 'Where the mana you make waits to be spent. What you don’t use disappears at the end of each step.',
      pt: 'Onde a mana gerada espera para ser gasta. O que não for usado some no fim de cada etapa.',
    },
  },
  creature: {
    name: { en: 'Creature', pt: 'Criatura' },
    text: {
      en: 'A permanent that attacks and blocks. 2/2 means power 2 (damage it deals) and toughness 2 (damage it takes before dying).',
      pt: 'Permanente que ataca e bloqueia. 2/2 é poder 2 (o dano que causa) e resistência 2 (o dano que aguenta antes de morrer).',
    },
  },
  sickness: {
    name: { en: 'Summoning sickness', pt: 'Enjoo de invocação' },
    text: {
      en: 'A creature can only attack starting on your next turn after it arrives. It can block right away.',
      pt: 'A criatura só pode atacar a partir do seu próximo turno depois que chegou. Bloquear ela pode na hora.',
    },
  },
  instant: {
    name: { en: 'Instants and sorceries', pt: 'Instantâneas e feitiços' },
    text: {
      en: 'Spells that do their effect and go to the graveyard: they are not permanents. Instants can be cast at any time; sorceries only in your main phase.',
      pt: 'Mágicas que fazem o efeito e vão para o cemitério: não são permanentes. Instantâneas podem ser jogadas a qualquer momento; feitiços, só na sua fase principal.',
    },
  },
  graveyard: {
    name: { en: 'Graveyard', pt: 'Cemitério' },
    text: {
      en: 'Each player’s discard pile: used spells and destroyed permanents go there, face up.',
      pt: 'A pilha de descarte de cada jogador: mágicas usadas e permanentes destruídas vão para lá, viradas para cima.',
    },
  },
  attack: {
    name: { en: 'Attacking', pt: 'Atacar' },
    text: {
      en: 'In combat, tap your creatures to attack. Unblocked, each one deals damage equal to its power to the opponent.',
      pt: 'No combate, vire suas criaturas para atacar. Sem bloqueio, cada uma causa ao oponente dano igual ao poder dela.',
    },
  },
  block: {
    name: { en: 'Blocking', pt: 'Bloquear' },
    text: {
      en: 'Your untapped creatures can stand in front of attackers. They deal damage to each other, and you take none from that attacker.',
      pt: 'Suas criaturas desviradas podem ficar na frente de um atacante. Elas causam dano uma na outra, e você não toma dano daquele atacante.',
    },
  },
} satisfies Record<string, { name: L; text: L }>

export type TermKey = keyof typeof TERMS
