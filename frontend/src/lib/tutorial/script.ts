/*
 * Roteiro da partida tutorial: uma aula de Magic em forma de partida 1 contra 1 contra o
 * Upkeeper. Cada passo é uma fala dele e, quase sempre, um clique que o jogador precisa dar.
 * As cartas e as jogadas são sempre as mesmas (cards.ts).
 *
 * Texto: **negrito** vira destaque dourado, *itálico* vira itálico e {G} vira o símbolo de mana.
 */
import type { L } from './cards'
import type { TermKey } from './glossary'
import {
  castCreature,
  castSpell,
  destroy,
  draw,
  endTurn,
  fieldCard,
  loseLife,
  playLand,
  startTurn,
  tapLand,
  type TState,
} from './state'

/** O que dá para clicar: o id de uma carta ou um destes */
export type Target = string
export const BUTTONS = ['library', 'mulligan', 'keep', 'combat', 'attack', 'pass'] as const

export type Step = {
  id: string
  say: L
  /** Muda o estado assim que o passo aparece (jogadas do Upkeeper, troca de fase) */
  enter?: (s: TState) => void
  /** O que o jogador precisa clicar; sem isto, o botão Continuar avança */
  click?: Target[]
  /** Quantos dos alvos precisam ser clicados (padrão: 1) */
  need?: number
  /** Efeito de cada clique certo */
  act?: (s: TState, target: Target) => void
  /** Cartas em destaque sem clique (as que a fala comenta) */
  spot?: string[]
  learn?: TermKey[]
  /** Dica para um clique errado, por alvo */
  wrong?: Record<string, L>
  /** Texto do botão Continuar */
  next?: L
  /** Último passo: a vitória */
  finish?: boolean
}

const UPKEEPER_HAND = ['swamp1', 'swamp2', 'corpse', 'zombies', 'hidden1', 'hidden2', 'hidden3']
const FIRST_HAND = ['bears_a', 'courser_a', 'giant_a', 'wurm_a', 'shock_a', 'growth_a', 'axe_a']
const SECOND_HAND = ['forest1', 'mountain1', 'forest2', 'bears', 'courser', 'shock', 'wurm']

const TAP_SHOCK: L = {
  en: 'Shock costs {R}, red mana. Only the Mountain makes red.',
  pt: 'O Choque custa {R}, mana vermelha. Só a Montanha gera vermelho.',
}
const TAP_GROWTH: L = {
  en: 'Giant Growth costs {G}, green mana. Mountains make red; tap a Forest.',
  pt: 'O Crescimento Desenfreado custa {G}, mana verde. Montanha gera vermelho; vire uma Floresta.',
}

export const STEPS: Step[] = [
  // ---------------------------------------------------------------- Começo
  {
    id: 'hello',
    say: {
      en: 'Hi! I’m the **Upkeeper**, keeper of this table. Today I’ll teach you the basics of Magic in a quick game, just the two of us. I’m your opponent… and your teacher. I promise to go easy on you!',
      pt: 'Olá! Eu sou o **Upkeeper**, o guardião desta mesa. Hoje vou te ensinar o básico de Magic numa partida rápida, só nós dois. Eu sou o seu oponente… e o seu professor. Prometo pegar leve!',
    },
    next: { en: 'Let’s go', pt: 'Vamos lá' },
  },
  {
    id: 'life',
    say: {
      en: 'Each player starts with **life points**. In a one-on-one game it’s 20 (in Commander, what people play here on Upkeeper, it’s 40). Reach 0 and you lose. For this lesson I start with only **10**, so we don’t take all day.',
      pt: 'Cada jogador começa com **pontos de vida**. Numa partida 1 contra 1 são 20 (no Commander, que é o que se joga aqui no Upkeeper, são 40). Chegou a 0, perdeu. Para esta aula eu começo com só **10**, para a gente não demorar.',
    },
    learn: ['life'],
  },
  {
    id: 'library',
    say: {
      en: 'This pile is your **library**: your deck, shuffled and face down. Nobody knows the order of the cards. Click it to draw your **opening hand** of 7 cards.',
      pt: 'Este monte é o seu **grimório**: o seu deck, embaralhado e virado para baixo. Ninguém sabe a ordem das cartas. Clique nele para comprar a sua **mão inicial** de 7 cartas.',
    },
    click: ['library'],
    act: (s) => {
      draw(s, 'you', ...FIRST_HAND)
      draw(s, 'opp', ...UPKEEPER_HAND)
    },
    learn: ['library'],
  },
  {
    id: 'no-lands',
    say: {
      en: 'This is your **hand**: only you can see these cards. But look: there’s no **land**! Lands make **mana**, the energy that pays for every other card. With no lands, you can’t play any of these.',
      pt: 'Esta é a sua **mão**: só você vê estas cartas. Mas repare: não tem nenhum **terreno**! Os terrenos geram **mana**, a energia que paga todas as outras cartas. Sem terreno, nenhuma destas cartas pode ser jogada.',
    },
    learn: ['hand', 'land'],
  },
  {
    id: 'mulligan',
    say: {
      en: 'When your opening hand is bad, you can take a **mulligan**: shuffle the hand back into the library and draw 7 new cards. The price: for each mulligan, you put 1 card of the new hand on the bottom of your library. Click **Mulligan**.',
      pt: 'Quando a mão inicial é ruim, você pode fazer **mulligan**: embaralhar a mão de volta no grimório e comprar 7 cartas novas. O preço: para cada mulligan, você coloca 1 carta da mão nova no fundo do grimório. Clique em **Mulligan**.',
    },
    click: ['mulligan'],
    wrong: {
      keep: {
        en: 'With this hand you couldn’t play anything. Better take a mulligan!',
        pt: 'Com essa mão você não conseguiria jogar nada. Melhor fazer mulligan!',
      },
    },
    act: (s) => {
      s.you.hand = []
      s.you.library += 7
      draw(s, 'you', ...SECOND_HAND)
    },
  },
  {
    id: 'bottom',
    say: {
      en: 'New hand, much better: 3 lands and some cheap spells. Now pay the price: choose 1 card to put on the bottom. **Craw Wurm** costs 6 mana, it would take ages to cast. Click it.',
      pt: 'Mão nova, bem melhor: 3 terrenos e mágicas baratas. Agora pague o preço: escolha 1 carta para o fundo do grimório. A **Serpente Terrestre de Craw** custa 6 de mana, ia demorar muito para usar. Clique nela.',
    },
    click: ['wurm'],
    wrong: {
      forest1: { en: 'Keep the lands! Without them nothing gets played.', pt: 'Guarde os terrenos! Sem eles nada é jogado.' },
      forest2: { en: 'Keep the lands! Without them nothing gets played.', pt: 'Guarde os terrenos! Sem eles nada é jogado.' },
      mountain1: { en: 'Keep the lands! Without them nothing gets played.', pt: 'Guarde os terrenos! Sem eles nada é jogado.' },
    },
    act: (s) => {
      s.you.hand = s.you.hand.filter((id) => id !== 'wurm')
      s.you.library += 1
    },
  },
  {
    id: 'keep',
    say: {
      en: '6 cards in hand. Now click **Keep** to stay with this hand. Good to know: in Commander, with more players, the first mulligan is free.',
      pt: '6 cartas na mão. Agora clique em **Manter** para ficar com essa mão. Bom saber: no Commander, que tem mais jogadores, o primeiro mulligan é de graça.',
    },
    click: ['keep'],
    learn: ['mulligan'],
  },

  // ---------------------------------------------------------------- Seu turno 1
  {
    id: 'phases',
    enter: (s) => startTurn(s, 'you', 1),
    say: {
      en: 'I’ll keep mine too. You go first! Every turn goes through the same **phases**, shown in the bar in the middle: **untap**, **upkeep**, **draw**, **main phase**, **combat**, **second main phase** and **end**. I’ll explain each one as we use it.',
      pt: 'Eu também mantenho a minha. Você começa! Todo turno passa pelas mesmas **fases**, que aparecem na barra do meio: **desvirar**, **manutenção**, **compra**, **fase principal**, **combate**, **segunda fase principal** e **final**. Vou explicar cada uma quando a gente usar.',
    },
    learn: ['phases'],
  },
  {
    id: 'skip-draw',
    enter: (s) => {
      s.phase = 'main1'
    },
    say: {
      en: 'Whoever starts the game doesn’t draw on the first turn (that’s the cost of going first). So we jump straight to the **main phase**, where you play your cards.',
      pt: 'Quem começa a partida não compra carta no primeiro turno (é o preço de sair na frente). Então vamos direto para a **fase principal**, onde você joga as suas cartas.',
    },
  },
  {
    id: 'land1',
    say: {
      en: 'In your main phase you can play **one land per turn**. Click the **Forest** to put it onto the battlefield.',
      pt: 'Na fase principal você pode jogar **um terreno por turno**. Clique na **Floresta** para colocá-la no campo de batalha.',
    },
    click: ['forest1'],
    act: (s, id) => playLand(s, 'you', id),
  },
  {
    id: 'permanent',
    say: {
      en: 'There it is! The Forest is now on the **battlefield**, the area between the players. Cards that stay on the battlefield after being played are called **permanents**: lands, creatures, artifacts, enchantments and planeswalkers. They stay there, turn after turn, until something removes them.',
      pt: 'Isso! A Floresta agora está no **campo de batalha**, a área entre os jogadores. Cartas que ficam no campo depois de jogadas se chamam **permanentes**: terrenos, criaturas, artefatos, encantamentos e planeswalkers. Elas continuam ali, turno após turno, até algo tirá-las de lá.',
    },
    spot: ['forest1'],
    learn: ['battlefield', 'permanent'],
  },
  {
    id: 'pass1',
    say: {
      en: 'You still have a Mountain and a Forest in hand, but remember: **only one land per turn** (try clicking one to see!). There’s nothing else to do, so click **Pass turn**.',
      pt: 'Você ainda tem uma Montanha e uma Floresta na mão, mas lembre: **só um terreno por turno** (pode clicar numa delas para ver!). Não há mais nada para fazer, então clique em **Passar o turno**.',
    },
    click: ['pass'],
    act: (s) => endTurn(s),
  },

  // ---------------------------------------------------------------- Upkeeper, turno 1
  {
    id: 'opp1',
    enter: (s) => {
      startTurn(s, 'opp', 1)
      s.phase = 'draw'
      draw(s, 'opp', 'hidden4')
      s.phase = 'main1'
      playLand(s, 'opp', 'swamp1')
    },
    say: {
      en: 'My turn! I go second, so I **draw** a card normally. Then I play a **Swamp**, a land that makes black mana. That’s all for me.',
      pt: 'Minha vez! Eu jogo em segundo, então **compro** uma carta normalmente. Depois jogo um **Pântano**, um terreno que gera mana preta. Por mim é só.',
    },
    spot: ['swamp1'],
    next: { en: 'Continue', pt: 'Continuar' },
  },

  // ---------------------------------------------------------------- Seu turno 2
  {
    id: 'untap2',
    enter: (s) => {
      endTurn(s)
      startTurn(s, 'you', 2)
    },
    say: {
      en: 'Your turn 2. First comes the **untap** step: everything of yours that is tapped goes back upright. Nothing was used yet, so nothing changes. Then the **upkeep** (that’s where my name comes from!): some cards do things at this moment; none of ours do.',
      pt: 'Seu turno 2. Primeiro vem a fase de **desvirar**: tudo o que é seu e está virado volta ao normal. Ainda não usamos nada, então nada muda. Depois vem a **manutenção** (em inglês, *upkeep*… daí o meu nome!): algumas cartas fazem coisas nessa hora; as nossas, não.',
    },
    learn: ['untap', 'upkeep'],
  },
  {
    id: 'draw2',
    enter: (s) => {
      s.phase = 'draw'
    },
    say: {
      en: 'Now the **draw** step: you draw 1 card from your library. Click it.',
      pt: 'Agora a fase de **compra**: você compra 1 carta do grimório. Clique nele.',
    },
    click: ['library'],
    act: (s) => draw(s, 'you', 'growth'),
    learn: ['draw'],
  },
  {
    id: 'land2',
    enter: (s) => {
      s.phase = 'main1'
    },
    say: {
      en: 'You drew **Giant Growth**: hold on to it, it will be useful later! Main phase: play the **Mountain**.',
      pt: 'Você comprou **Crescimento Desenfreado**: guarde, ele vai ser útil mais tarde! Fase principal: jogue a **Montanha**.',
    },
    click: ['mountain1'],
    act: (s, id) => playLand(s, 'you', id),
  },
  {
    id: 'cost',
    say: {
      en: 'Time for your first creature: **Grizzly Bears**. Look at the top corner of the card: {1}{G}. That’s its **mana cost**. {G} is green mana (from a Forest); {1} is **generic** mana, it can be any color. Total: 2 mana.',
      pt: 'Hora da primeira criatura: os **Ursos Cinzentos**. Olhe o canto de cima da carta: {1}{G}. Esse é o **custo de mana**. O {G} é mana verde (de Floresta); o {1} é mana **genérica**, pode ser de qualquer cor. Total: 2 de mana.',
    },
    spot: ['bears'],
    learn: ['cost'],
  },
  {
    id: 'tap2',
    say: {
      en: 'To make mana, you **tap** a land (turn it sideways). Each tapped land gives 1 mana of its color. Click the Forest and the Mountain to tap them.',
      pt: 'Para gerar mana, você **vira** o terreno (gira ele de lado). Cada terreno virado dá 1 mana da cor dele. Clique na Floresta e na Montanha para virá-las.',
    },
    click: ['forest1', 'mountain1'],
    need: 2,
    act: (s, id) => tapLand(s, id),
    learn: ['tap'],
  },
  {
    id: 'cast-bears',
    say: {
      en: 'Your **mana pool** now has {G}{R}. {G} pays the green and {R} pays the generic {1}. Click **Grizzly Bears** to cast them.',
      pt: 'A sua **reserva de mana** agora tem {G}{R}. O {G} paga o verde e o {R} paga o {1} genérico. Clique nos **Ursos Cinzentos** para conjurá-los.',
    },
    click: ['bears'],
    act: (s, id) => castCreature(s, 'you', id),
    learn: ['mana'],
  },
  {
    id: 'creature',
    say: {
      en: 'The Bears are here! Creatures are **permanents** too. The numbers at the bottom, **2/2**, are **power/toughness**: power is the damage it deals, toughness is how much damage it can take. But watch out: creatures have **summoning sickness** and can only attack starting on your next turn.',
      pt: 'Os Ursos chegaram! Criaturas também são **permanentes**. Os números embaixo, **2/2**, são **poder/resistência**: o poder é o dano que ela causa; a resistência, quanto dano ela aguenta. Mas atenção: criaturas têm **enjoo de invocação** e só podem atacar a partir do seu próximo turno.',
    },
    spot: ['bears'],
    learn: ['creature', 'sickness'],
  },
  {
    id: 'pass2',
    say: {
      en: 'That’s it for now. Click **Pass turn**.',
      pt: 'Por agora é isso. Clique em **Passar o turno**.',
    },
    click: ['pass'],
    act: (s) => endTurn(s),
  },

  // ---------------------------------------------------------------- Upkeeper, turno 2
  {
    id: 'opp2',
    enter: (s) => {
      startTurn(s, 'opp', 2)
      draw(s, 'opp', 'hidden5')
      s.phase = 'main1'
      playLand(s, 'opp', 'swamp2')
      tapLand(s, 'swamp1')
      tapLand(s, 'swamp2')
      castCreature(s, 'opp', 'corpse')
    },
    say: {
      en: 'My turn again: I untap, draw, play another **Swamp**, tap both and cast **Walking Corpse**, a 2/2 creature. It has summoning sickness too, so it doesn’t attack now. Your turn!',
      pt: 'Minha vez de novo: desviro, compro, jogo outro **Pântano**, viro os dois e conjuro o **Cadáver Ambulante**, uma criatura 2/2. Ele também está com enjoo de invocação, então não ataca agora. Sua vez!',
    },
    spot: ['corpse'],
    next: { en: 'Continue', pt: 'Continuar' },
  },

  // ---------------------------------------------------------------- Seu turno 3
  {
    id: 'untap3',
    enter: (s) => {
      endTurn(s)
      startTurn(s, 'you', 3)
    },
    say: {
      en: 'Turn 3! In the untap step your Forest and Mountain went back upright, ready to make mana again. That happens at the start of every turn of yours.',
      pt: 'Turno 3! Na fase de desvirar, a sua Floresta e a sua Montanha voltaram ao normal, prontas para gerar mana de novo. Isso acontece no começo de todo turno seu.',
    },
    spot: ['forest1', 'mountain1'],
  },
  {
    id: 'draw3',
    enter: (s) => {
      s.phase = 'draw'
    },
    say: { en: 'Draw your card.', pt: 'Compre a sua carta.' },
    click: ['library'],
    act: (s) => draw(s, 'you', 'mountain2'),
  },
  {
    id: 'land3',
    enter: (s) => {
      s.phase = 'main1'
    },
    say: {
      en: 'Another Mountain. This turn, play the **Forest**.',
      pt: 'Mais uma Montanha. Neste turno, jogue a **Floresta**.',
    },
    click: ['forest2'],
    act: (s, id) => playLand(s, 'you', id),
    wrong: {
      mountain2: {
        en: 'It would work too, but let’s follow the plan: play the Forest.',
        pt: 'Também daria, mas vamos seguir o plano: jogue a Floresta.',
      },
    },
  },
  {
    id: 'shock-intro',
    say: {
      en: 'That **Walking Corpse** is in your way: if you attack, it can **block**. How about removing it? **Shock** is an **instant**: it deals 2 damage to any target. The Corpse has toughness 2… so 2 damage is enough to destroy it.',
      pt: 'Aquele **Cadáver Ambulante** atrapalha o seu ataque: se você atacar, ele pode **bloquear**. Que tal tirá-lo do caminho? O **Choque** é uma **mágica instantânea**: causa 2 pontos de dano a qualquer alvo. O Cadáver tem resistência 2… então 2 de dano bastam para destruí-lo.',
    },
    spot: ['shock', 'corpse'],
  },
  {
    id: 'tap-mountain',
    say: {
      en: 'Shock costs {R}. Tap only the **Mountain**: no need to tap what you won’t use.',
      pt: 'O Choque custa {R}. Vire só a **Montanha**: não precisa virar o que você não vai usar.',
    },
    click: ['mountain1'],
    act: (s, id) => tapLand(s, id),
    wrong: { forest1: TAP_SHOCK, forest2: TAP_SHOCK },
  },
  {
    id: 'cast-shock',
    say: { en: 'Now click **Shock**.', pt: 'Agora clique no **Choque**.' },
    click: ['shock'],
    act: (s, id) => {
      s.casting = id
    },
  },
  {
    id: 'target-corpse',
    say: {
      en: 'Choose the **target**: click the Upkeeper’s **Walking Corpse**.',
      pt: 'Escolha o **alvo**: clique no **Cadáver Ambulante** do Upkeeper.',
    },
    click: ['corpse'],
    act: (s) => {
      s.casting = null
      castSpell(s, 'you', 'shock')
      destroy(s, 'corpse')
    },
    wrong: {
      bears: {
        en: 'Not your own Bears! Aim at the Upkeeper’s creature.',
        pt: 'Nos seus Ursos não! Mire na criatura do Upkeeper.',
      },
    },
  },
  {
    id: 'graveyard',
    say: {
      en: 'Done! The Corpse took 2 damage, equal to its toughness, and was **destroyed**: it went to the **graveyard**, each player’s discard pile. And notice: Shock went to your graveyard too. Instants and **sorceries** do their thing and leave: they are **not permanents**. The difference? Instants can be cast at any time, even on the opponent’s turn; sorceries only in your main phase.',
      pt: 'Pronto! O Cadáver levou 2 de dano, igual à resistência dele, e foi **destruído**: foi para o **cemitério**, a pilha de descarte de cada jogador. E repare: o Choque também foi para o seu cemitério. Mágicas instantâneas e **feitiços** fazem o efeito e vão embora: eles **não são permanentes**. A diferença? Instantâneas podem ser jogadas a qualquer momento, até no turno do oponente; feitiços, só na sua fase principal.',
    },
    learn: ['graveyard', 'instant'],
  },
  {
    id: 'to-combat3',
    say: {
      en: 'The way is clear. Let’s go to the **combat** phase: click **Combat**.',
      pt: 'O caminho está livre. Vamos para a fase de **combate**: clique em **Combate**.',
    },
    click: ['combat'],
    act: (s) => {
      s.phase = 'combat'
    },
  },
  {
    id: 'attack3',
    say: {
      en: 'Click **Grizzly Bears** to declare them as **attackers**. They no longer have summoning sickness: they’ve been with you since last turn. Attacking **taps** the creature.',
      pt: 'Clique nos **Ursos Cinzentos** para declará-los como **atacantes**. Eles já não têm enjoo de invocação: estão com você desde o turno passado. Atacar **vira** a criatura.',
    },
    click: ['bears'],
    act: (s, id) => {
      const c = fieldCard(s, id)!
      c.tapped = true
      c.attacking = true
    },
  },
  {
    id: 'confirm3',
    say: { en: 'Click **Attack** to confirm.', pt: 'Clique em **Atacar** para confirmar.' },
    click: ['attack'],
    act: (s) => {
      s.declared = true
      loseLife(s, 'opp', 2)
    },
  },
  {
    id: 'damage3',
    say: {
      en: 'I have no creatures to block, so the attack goes straight through: I lose 2 life (10 → 8). Ouch!',
      pt: 'Não tenho criaturas para bloquear, então o ataque passa direto: eu perco 2 pontos de vida (10 → 8). Ai!',
    },
    learn: ['attack'],
  },
  {
    id: 'main2',
    enter: (s) => {
      s.phase = 'main2'
      for (const c of s.you.field) c.attacking = false
    },
    say: {
      en: 'After combat comes the **second main phase**: you can play a land (if you haven’t yet) and cast spells here too. You still have two untapped Forests, but **Centaur Courser** costs 3. That’s for next turn. Click **Pass turn**.',
      pt: 'Depois do combate vem a **segunda fase principal**: dá para jogar terreno (se ainda não jogou) e conjurar mágicas aqui também. Você ainda tem duas Florestas desviradas, mas a **Centaura-caçadora** custa 3. Fica para o próximo turno. Clique em **Passar o turno**.',
    },
    click: ['pass'],
    act: (s) => endTurn(s),
  },

  // ---------------------------------------------------------------- Upkeeper, turno 3
  {
    id: 'opp3',
    enter: (s) => {
      startTurn(s, 'opp', 3)
      draw(s, 'opp', 'swamp3')
      s.phase = 'main1'
      playLand(s, 'opp', 'swamp3')
      for (const id of ['swamp1', 'swamp2', 'swamp3']) tapLand(s, id)
      castCreature(s, 'opp', 'zombies')
    },
    say: {
      en: 'Hmm, you’re good at this. My turn: I untap, draw, play my third **Swamp** and cast **Scathe Zombies** (2/2). Done.',
      pt: 'Hmm, você leva jeito. Minha vez: desviro, compro, jogo o terceiro **Pântano** e conjuro os **Zumbis de Scathe** (2/2). Pronto.',
    },
    spot: ['zombies'],
    next: { en: 'Continue', pt: 'Continuar' },
  },

  // ---------------------------------------------------------------- Seu turno 4
  {
    id: 'draw4',
    enter: (s) => {
      endTurn(s)
      startTurn(s, 'you', 4)
      s.phase = 'draw'
    },
    say: {
      en: 'Turn 4! Everything untapped, including the Bears that attacked. Draw your card.',
      pt: 'Turno 4! Tudo desvirou, inclusive os Ursos que atacaram. Compre a sua carta.',
    },
    click: ['library'],
    act: (s) => draw(s, 'you', 'forest3'),
  },
  {
    id: 'land4',
    enter: (s) => {
      s.phase = 'main1'
    },
    say: { en: 'Play the **Forest**.', pt: 'Jogue a **Floresta**.' },
    click: ['forest3'],
    act: (s, id) => playLand(s, 'you', id),
    wrong: {
      mountain2: {
        en: 'It would work too, but let’s follow the plan: play the Forest.',
        pt: 'Também daria, mas vamos seguir o plano: jogue a Floresta.',
      },
    },
  },
  {
    id: 'tap4',
    say: {
      en: '**Centaur Courser** costs {2}{G}: 3 mana, at least 1 of it green. Tap **3 lands** of your choice.',
      pt: 'A **Centaura-caçadora** custa {2}{G}: 3 de mana, sendo pelo menos 1 verde. Vire **3 terrenos**, à sua escolha.',
    },
    spot: ['courser'],
    click: ['forest1', 'forest2', 'forest3', 'mountain1'],
    need: 3,
    act: (s, id) => tapLand(s, id),
  },
  {
    id: 'cast-courser',
    say: { en: 'Now cast **Centaur Courser**.', pt: 'Agora conjure a **Centaura-caçadora**.' },
    click: ['courser'],
    act: (s, id) => castCreature(s, 'you', id),
  },
  {
    id: 'hold',
    say: {
      en: 'The Courser is a 3/3, but it has summoning sickness. And the Bears? If they attack, **Scathe Zombies** (2/2) can block and both die: 2 damage to each. Sometimes **not attacking** is the best play. Click **Pass turn**.',
      pt: 'A Centaura é 3/3, mas está com enjoo de invocação. E os Ursos? Se atacarem, os **Zumbis de Scathe** (2/2) podem bloquear e os dois morrem: 2 de dano em cada um. Às vezes, **não atacar** é a melhor jogada. Clique em **Passar o turno**.',
    },
    spot: ['zombies'],
    click: ['pass'],
    act: (s) => endTurn(s),
  },

  // ---------------------------------------------------------------- Upkeeper, turno 4
  {
    id: 'opp-attack',
    enter: (s) => {
      startTurn(s, 'opp', 4)
      draw(s, 'opp', 'swamp4')
      s.phase = 'main1'
      playLand(s, 'opp', 'swamp4')
      s.phase = 'combat'
      const z = fieldCard(s, 'zombies')!
      z.tapped = true
      z.attacking = true
    },
    say: {
      en: 'My turn! I’ll attack you with **Scathe Zombies**… just to teach you how to **block**. When the opponent attacks, each of your **untapped** creatures can block one attacker.',
      pt: 'Minha vez! Vou atacar você com os **Zumbis de Scathe**… só para te ensinar a **bloquear**. Quando o oponente ataca, cada criatura sua que está **desvirada** pode bloquear um atacante.',
    },
    spot: ['zombies'],
    next: { en: 'Continue', pt: 'Continuar' },
  },
  {
    id: 'block',
    say: {
      en: 'Click **Centaur Courser** to block the Zombies. (Summoning sickness doesn’t stop a creature from blocking!)',
      pt: 'Clique na **Centaura-caçadora** para bloquear os Zumbis. (Enjoo de invocação não impede de bloquear!)',
    },
    click: ['courser'],
    act: (s, id) => {
      fieldCard(s, id)!.blocking = 'zombies'
    },
    wrong: {
      bears: {
        en: 'The Bears could block too, but they would die along with the Zombies (2 damage each). The 3/3 Courser survives and wins!',
        pt: 'Os Ursos também poderiam bloquear, mas morreriam junto (2 de dano em cada um). A Centaura 3/3 aguenta e vence!',
      },
    },
  },
  {
    id: 'block-result',
    enter: (s) => {
      fieldCard(s, 'courser')!.damage = 2
      destroy(s, 'zombies')
    },
    say: {
      en: 'Combat! The Courser deals 3 damage to the Zombies (toughness 2): they die. The Zombies deal 2 to the Courser (toughness 3): it survives. And you lost no life, because a blocked creature doesn’t damage you. Damage wears off at the end of the turn, so the Courser will be as good as new.',
      pt: 'Combate! A Centaura causa 3 de dano nos Zumbis (resistência 2): eles morrem. Os Zumbis causam 2 na Centaura (resistência 3): ela sobrevive. E você não perdeu vida, porque a criatura bloqueada não causa dano a você. O dano some no fim do turno: a Centaura volta novinha.',
    },
    learn: ['block'],
  },
  {
    id: 'opp-end',
    enter: (s) => {
      s.phase = 'main2'
    },
    say: {
      en: 'Phew… I’m out of creatures. I pass the turn.',
      pt: 'Ufa… fiquei sem criaturas. Passo o turno.',
    },
    next: { en: 'Continue', pt: 'Continuar' },
  },

  // ---------------------------------------------------------------- Seu turno 5
  {
    id: 'draw5',
    enter: (s) => {
      endTurn(s)
      startTurn(s, 'you', 5)
      s.phase = 'draw'
    },
    say: {
      en: 'Turn 5. I’m at **8** life and have no creatures. Draw your card.',
      pt: 'Turno 5. Estou com **8** de vida e sem nenhuma criatura. Compre a sua carta.',
    },
    click: ['library'],
    act: (s) => draw(s, 'you', 'giant'),
  },
  {
    id: 'land5',
    enter: (s) => {
      s.phase = 'main1'
    },
    say: {
      en: 'You drew **Hill Giant**. Play the **Mountain**.',
      pt: 'Você comprou o **Gigante da Colina**. Jogue a **Montanha**.',
    },
    click: ['mountain2'],
    act: (s, id) => playLand(s, 'you', id),
  },
  {
    id: 'math',
    say: {
      en: 'Do the math: Bears (2) + Courser (3) = 5 damage. I have 8. Not enough… or is it? Remember **Giant Growth**? It gives a creature **+3/+3 until end of turn**. 5 + 3 = **8**. Exactly what you need!',
      pt: 'Faça as contas: Ursos (2) + Centaura (3) = 5 de dano. Eu tenho 8. Não dá… ou dá? Lembra do **Crescimento Desenfreado**? Ele dá **+3/+3 até o final do turno** a uma criatura. 5 + 3 = **8**. Exatamente o que você precisa!',
    },
    spot: ['growth'],
  },
  {
    id: 'to-combat5',
    say: { en: 'To **combat**!', pt: 'Para o **combate**!' },
    click: ['combat'],
    act: (s) => {
      s.phase = 'combat'
    },
  },
  {
    id: 'attack5',
    say: {
      en: 'Declare both as attackers: click **Grizzly Bears** and **Centaur Courser**.',
      pt: 'Declare os dois como atacantes: clique nos **Ursos Cinzentos** e na **Centaura-caçadora**.',
    },
    click: ['bears', 'courser'],
    need: 2,
    act: (s, id) => {
      const c = fieldCard(s, id)!
      c.tapped = true
      c.attacking = true
    },
  },
  {
    id: 'confirm5',
    say: { en: 'Click **Attack**.', pt: 'Clique em **Atacar**.' },
    click: ['attack'],
    act: (s) => {
      s.declared = true
    },
  },
  {
    id: 'trick',
    say: {
      en: 'I have nothing to block with… But before damage, you can still cast **instants**. Time for the trick! Tap a **Forest** to make {G}.',
      pt: 'Não tenho com o que bloquear… Mas antes do dano ainda dá para jogar **mágicas instantâneas**. Hora do truque! Vire uma **Floresta** para gerar {G}.',
    },
    click: ['forest1', 'forest2', 'forest3'],
    act: (s, id) => tapLand(s, id),
    wrong: { mountain1: TAP_GROWTH, mountain2: TAP_GROWTH },
  },
  {
    id: 'cast-growth',
    say: { en: 'Click **Giant Growth**…', pt: 'Clique no **Crescimento Desenfreado**…' },
    click: ['growth'],
    act: (s, id) => {
      s.casting = id
    },
  },
  {
    id: 'target-growth',
    say: {
      en: '…and choose the target: one of your attacking creatures.',
      pt: '…e escolha o alvo: uma das suas criaturas atacantes.',
    },
    click: ['bears', 'courser'],
    act: (s, id) => {
      s.casting = null
      castSpell(s, 'you', 'growth')
      fieldCard(s, id)!.pump = 3
    },
  },
  {
    id: 'lethal',
    enter: (s) => {
      loseLife(s, 'opp', 8)
    },
    say: {
      en: 'Your creature grew! Now combat damage: 2 + 3 + 3 = 8. I go from 8 to **0**…',
      pt: 'A sua criatura cresceu! Agora o dano de combate: 2 + 3 + 3 = 8. Eu vou de 8 para **0**…',
    },
    next: { en: 'Continue', pt: 'Continuar' },
  },
  {
    id: 'win',
    say: {
      en: '**You won!** Well played. Now you know the basics: lands make mana, mana pays for spells, permanents stay on the battlefield, creatures attack and block, and whoever reaches 0 life loses. Ready for a real table?',
      pt: '**Você venceu!** Bem jogado. Agora você sabe o básico: terrenos geram mana, a mana paga as mágicas, as permanentes ficam no campo, criaturas atacam e bloqueiam, e quem chega a 0 de vida perde. Pronto para uma mesa de verdade?',
    },
    finish: true,
  },
]
