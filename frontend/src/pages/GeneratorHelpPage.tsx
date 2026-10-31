import { useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  Bot,
  CircleHelp,
  ClipboardList,
  Crown,
  Database,
  Gauge,
  Layers,
  ListChecks,
  Mountain,
  Server,
  ShieldCheck,
  Sigma,
  Sparkles,
  Users,
  Wallet,
  WandSparkles,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { useTitle } from '../hooks/useTitle'
import { BRACKET_NAMES } from '../lib/brackets'
import {
  CARD_SHARE,
  cardScore,
  FEW_TUTORS,
  GAME_CHANGERS,
  LOW_BUDGET,
  OWNED_FILL_CAP,
  ROLE_ORDER,
  ROLE_TARGETS,
  SCORE_WEIGHTS,
  UPGRADE_UNTIL,
} from '../lib/generator'
import { useI18n } from '../lib/i18n'
import { money } from '../lib/money'

/*
 * Como os decks são montados (/my-pool/generate/how-it-works): de onde vêm as cartas, os passos da
 * montagem, a nota de cada carta (com simulador), as regras de cada bracket, o orçamento (com simulador),
 * o modo "Usar minhas cartas" e a IA. Texto longo, escrito por idioma (como a página do ranking); os números
 * vêm de lib/generator.ts, as mesmas regras que montam o deck.
 */

const pct = (n: number) => `${Math.round(n * 100)}%`
const W = SCORE_WEIGHTS

const COPY = {
  pt: {
    title: 'Como os decks são montados',
    lead: 'O gerador não inventa cartas: ele parte do que os jogadores colocam nos decks do seu comandante, confere cada carta e ajusta tudo às suas escolhas. Aqui está, passo a passo, como o deck sai.',
    back: 'Voltar ao gerador',
    sourcesTitle: 'De onde vêm as cartas',
    sourcesLead: 'Quatro fontes, cada uma com uma tarefa. Quase tudo roda no seu navegador, como no deckbuilder.',
    sources: [
      ['EDHREC', 'edhrec.com', 'Quais cartas os jogadores colocam nos decks de cada comandante, e em quantos decks cada uma aparece, separado por tema, por bracket e por preço. É daqui que vem a lista de candidatas.'],
      ['Scryfall', 'scryfall.com', 'Confere cada candidata: se existe, se é legal em Commander, se cabe nas cores do comandante, o preço da edição mais barata e se é Game Changer.'],
      ['Upkeeper', 'nosso servidor', 'Diz a função de cada carta (ramp, compra, remoção, board wipe), pelas tags do Scryfall, e quais cartas você tem, no caminho “Usar minhas cartas”.'],
      ['Commander Spellbook', 'commanderspellbook.com', 'Confere o bracket do deck pronto: Game Changers, combos de 2 cartas, turnos extras e destruição de terrenos em massa.'],
    ],
    stepsTitle: 'Os passos da montagem',
    stepsLead: 'São os mesmos passos que aparecem na tela enquanto o deck é montado.',
    steps: [
      ['Lendo seu comandante', 'As cores do deck saem da identidade de cor do comandante (e do parceiro, se tiver). Toda carta precisa caber nelas.'],
      ['Vendo o que a comunidade joga', `Busca no EDHREC os decks do comandante no bracket escolhido e uma página para cada tema. Com orçamento de até ${money(LOW_BUDGET, 'USD', 'pt-BR', true)}, só os decks mais baratos.`],
      ['Planejando o deck', 'Quantos terrenos (a média dos decks do comandante), o mínimo de cada função pelo bracket e um teto para as cartas de custo alto, pela curva de mana desses decks.'],
      ['Escolhendo as mágicas', 'Primeiro as cotas: ramp, compra, remoção e board wipes, sempre a carta de nota mais alta que faz aquilo. Depois, as vagas que sobram vão para as cartas de nota mais alta.'],
      ['Montando a base de mana', 'Os terrenos não básicos que a comunidade usa com o comandante e, no resto, básicos divididos pelos símbolos de mana das cartas escolhidas.'],
      ['Ajustando ao orçamento', 'Passou do orçamento, troca por mais baratas; sobrou dinheiro, troca por cartas melhores. Detalhes mais abaixo.'],
      ['Conferindo o bracket', 'O Commander Spellbook confere o deck pronto. O que passar do bracket pedido sai, e entra outra carta com a mesma função.'],
    ],
    scoreTitle: 'A nota de cada carta',
    scoreLead: 'Toda candidata ganha uma nota de 0 a 100, que mistura três números do EDHREC:',
    scoreParts: [
      ['Nos decks do tema', 'De cada 100 decks do comandante com aquele tema, quantos têm a carta.'],
      ['Nos decks do comandante', 'De cada 100 decks do comandante no seu bracket, quantos têm a carta.'],
      ['Sinergia', 'O quanto a carta aparece mais com esse comandante do que nos outros decks das mesmas cores.'],
    ],
    formula: `Nota = ${pct(W.themed.theme)} tema + ${pct(W.themed.base)} comandante + ${pct(W.themed.synergy)} sinergia`,
    formulaPlain: `Sem tema escolhido: ${pct(W.plain.base)} comandante + ${pct(W.plain.synergy)} sinergia.`,
    formulaMulti: 'Com mais de um tema, conta metade o tema em que a carta mais aparece e metade a média dos temas: a carta que serve a mais de um sobe.',
    simTitle: 'Teste você mesmo',
    simText: 'Mexa nos números ou escolha um exemplo.',
    withTheme: 'Com tema',
    withoutTheme: 'Sem tema',
    inTheme: 'Nos decks do tema',
    inCommander: 'Nos decks do comandante',
    synergy: 'Sinergia',
    presets: [
      ['Sol Ring', 90, 88, 0],
      ['Carta do tema', 65, 25, 45],
      ['Carta qualquer', 8, 12, 2],
    ] as [string, number, number, number][],
    score: 'Nota',
    scoreNote: 'Por isso o deck mistura as cartas que quase todo deck usa (como o Sol Ring) com as que fazem o tema funcionar. As de nota baixa só entram se faltar carta.',
    rulesTitle: 'As regras de cada bracket',
    rulesLead: 'O mínimo de cartas de cada função e o que o bracket permite. Uma carta pode contar para mais de uma função.',
    cols: ['Bracket', 'Ramp', 'Compra', 'Remoção', 'Board wipes', 'Game Changers', 'Tutores'],
    free: 'livre',
    upTo: 'até {n}',
    none: 'nenhum',
    rulesNote: 'Remoção conta também as contramágicas. Terreno não conta como função: um terreno que compra carta não entra na cota de compra. Combos de 2 cartas, turnos extras e destruição de terrenos em massa ficam com o Commander Spellbook, no fim.',
    budgetTitle: 'O orçamento',
    budgetLead: 'O orçamento é um alvo: o gerador tenta chegar perto do valor sem passar, usando o dinheiro nas cartas que deixam o deck melhor.',
    budgetRules: [
      ['Passou do orçamento', 'Sai primeiro a carta que menos rende por dólar (nota baixa e preço alto), e entra a de nota mais alta entre as mais baratas que fazem a mesma coisa. Terreno caro vira básico.'],
      ['Sobrou dinheiro', 'Entram cartas melhores que cabem no que sobrou: as que ficaram de fora pelo teto por carta e as que os decks um bracket acima do seu jogam bem mais. As cartas que definem o tema ficam.'],
      ['Quando para', 'Ao chegar perto do orçamento, ou quando não há carta melhor que caiba. Se as melhores opções forem baratas, o deck sai mais barato.'],
    ],
    budgetSimTitle: 'Teste com um orçamento',
    budget: 'Orçamento',
    startsFrom: 'Parte de',
    cheapDecks: 'os decks mais baratos do comandante',
    allDecks: 'os decks de todos os preços do comandante',
    cardCap: 'Uma carta pode custar até',
    improvesUntil: 'Sobrando dinheiro, melhora o deck até',
    pricesNote: 'Os preços são da edição mais barata de cada carta no Scryfall, em dólares, e mudam todo dia.',
    ownedTitle: 'Só com as suas cartas',
    ownedLead: 'No caminho “Usar minhas cartas”, as candidatas vêm dos precons que você marcou e dos decks que você montou.',
    ownedPoints: [
      'As suas cartas vêm antes das outras, mesmo com nota mais baixa.',
      `Se não derem para todas as vagas, entram outras de até ${money(OWNED_FILL_CAP, 'USD', 'pt-BR', true)}, e o deck pronto mostra a lista do que falta.`,
      'Terreno que você não tem não entra: os básicos completam a mana.',
      'Não tem orçamento: o deck usa o que você já tem.',
    ],
    aiTitle: 'A IA (quando está ligada)',
    aiLead: 'A IA não escolhe as cartas do deck: a montagem é a mesma, com ou sem ela. Ela ajuda em duas coisas.',
    ai: [
      ['Descreva seu deck', 'Lê a frase e transforma em escolhas: comandante, cores, temas, orçamento, bracket e cartas que entram ou ficam de fora. Cada nome que ela devolve é conferido no Scryfall e no EDHREC antes de valer. Sem a IA, o site lê a frase com regras simples.'],
      ['Guia de jogo', 'Com o deck pronto, escreve um guia curto: os primeiros turnos, o plano e com o que tomar cuidado. As cartas que ela aponta como as que ganham o jogo são conferidas na lista.'],
    ],
    aiNote: 'Vai só o texto digitado ou a lista de cartas, nada da sua conta. Cada conta tem um limite de pedidos por dia, mostrado no topo do gerador.',
    notesTitle: 'Bom saber',
    notes: [
      'O gerador não lê o texto das cartas para entender combos e interações: ele confia no que a comunidade joga. Revise o deck antes de jogar.',
      'Comandante novo, com poucos decks no EDHREC, gera um deck menos afinado. Sem nenhum deck, o gerador usa as cartas mais jogadas nas cores do comandante.',
      'A função das cartas (ramp, compra, remoção) vem das tags do Scryfall e pode errar uma carta ou outra.',
      'Gerar de novo com as mesmas escolhas dá um deck parecido: para variar, mude os temas, o bracket ou o orçamento, ou use “Cartas que têm de entrar” e “Cartas que ficam de fora”.',
    ],
    faqTitle: 'Perguntas comuns',
    faq: [
      ['Por que meu deck saiu bem mais barato que o orçamento?', 'O gerador só gasta com cartas que deixam o deck melhor. Se as melhores opções do seu comandante e do seu bracket forem baratas, o deck fica abaixo do valor. Nos brackets 1 e 2 não entram Game Changers, que costumam ser as cartas mais caras.'],
      ['Por que a carta que eu queria não entrou?', 'Ela pode ser um Game Changer (proibido nos brackets 1 e 2 e limitado a 3 no bracket 3), custar mais que o teto por carta, estar fora das cores ou ter nota baixa. Para garantir, coloque-a em “Cartas que têm de entrar”: essas entram sempre.'],
      ['O deck é legal em Commander?', 'Sim: 100 cartas, uma cópia de cada (fora os básicos), todas nas cores do comandante e legais no formato. O bracket é estimado pelo Commander Spellbook e aparece no deck pronto.'],
      ['Posso mudar o deck depois?', 'Pode. “Abrir no deckbuilder” leva o deck para você mexer carta a carta, e as próximas da fila já vão para o maybeboard.'],
    ],
    open: 'Gerar um deck',
  },
  en: {
    title: 'How decks are built',
    lead: 'The generator doesn’t make cards up: it starts from what players put in decks with your commander, checks every card and fits everything to your choices. Here is, step by step, how the deck comes out.',
    back: 'Back to the generator',
    sourcesTitle: 'Where the cards come from',
    sourcesLead: 'Four sources, each with one job. Almost everything runs in your browser, like in the deckbuilder.',
    sources: [
      ['EDHREC', 'edhrec.com', 'Which cards players put in decks with each commander, and how many decks run each one, split by theme, bracket and price. This is where the list of candidates comes from.'],
      ['Scryfall', 'scryfall.com', 'Checks every candidate: that it exists, is legal in Commander, fits the commander’s colors, the price of its cheapest printing and whether it’s a Game Changer.'],
      ['Upkeeper', 'our server', 'Tells each card’s function (ramp, draw, removal, board wipe), from Scryfall’s tags, and which cards you own, in “Use my cards”.'],
      ['Commander Spellbook', 'commanderspellbook.com', 'Checks the finished deck’s bracket: Game Changers, two-card combos, extra turns and mass land denial.'],
    ],
    stepsTitle: 'The building steps',
    stepsLead: 'These are the same steps you see on screen while the deck is built.',
    steps: [
      ['Reading your commander', 'The deck’s colors come from the commander’s color identity (and its partner’s, if any). Every card has to fit them.'],
      ['Looking at what other people play', `Fetches from EDHREC the commander’s decks in the chosen bracket and one page per theme. With a budget up to ${money(LOW_BUDGET, 'USD', 'en-US', true)}, only the cheapest decks.`],
      ['Planning the deck', 'How many lands (the average of the commander’s decks), the minimum for each function by bracket and a cap on high-cost cards, from those decks’ mana curve.'],
      ['Choosing the spells', 'Quotas first: ramp, draw, removal and board wipes, always the highest-scoring card that does it. Then the remaining slots go to the highest-scoring cards.'],
      ['Building the mana base', 'The nonbasic lands the community runs with the commander and, for the rest, basics split by the mana symbols of the chosen cards.'],
      ['Fitting the budget', 'Over budget, it swaps for cheaper cards; money left, it swaps for better ones. Details below.'],
      ['Checking the bracket', 'Commander Spellbook checks the finished deck. Whatever goes above the bracket you asked for comes out, and another card with the same function goes in.'],
    ],
    scoreTitle: 'Each card’s score',
    scoreLead: 'Every candidate gets a score from 0 to 100, which mixes three EDHREC numbers:',
    scoreParts: [
      ['In the theme’s decks', 'Out of every 100 decks with the commander and that theme, how many run the card.'],
      ['In the commander’s decks', 'Out of every 100 decks with the commander in your bracket, how many run the card.'],
      ['Synergy', 'How much more the card shows up with this commander than in other decks of the same colors.'],
    ],
    formula: `Score = ${pct(W.themed.theme)} theme + ${pct(W.themed.base)} commander + ${pct(W.themed.synergy)} synergy`,
    formulaPlain: `With no theme picked: ${pct(W.plain.base)} commander + ${pct(W.plain.synergy)} synergy.`,
    formulaMulti: 'With more than one theme, half comes from the theme where the card shows up most and half from the themes’ average: a card that serves more than one goes up.',
    simTitle: 'Try it yourself',
    simText: 'Move the numbers or pick an example.',
    withTheme: 'With a theme',
    withoutTheme: 'No theme',
    inTheme: 'In the theme’s decks',
    inCommander: 'In the commander’s decks',
    synergy: 'Synergy',
    presets: [
      ['Sol Ring', 90, 88, 0],
      ['Theme card', 65, 25, 45],
      ['Random card', 8, 12, 2],
    ] as [string, number, number, number][],
    score: 'Score',
    scoreNote: 'That’s why the deck mixes the cards almost every deck runs (like Sol Ring) with the ones that make the theme work. Low-scoring cards only go in if there aren’t enough cards.',
    rulesTitle: 'Each bracket’s rules',
    rulesLead: 'The minimum number of cards for each function and what the bracket allows. A card can count for more than one function.',
    cols: ['Bracket', 'Ramp', 'Draw', 'Removal', 'Board wipes', 'Game Changers', 'Tutors'],
    free: 'any',
    upTo: 'up to {n}',
    none: 'none',
    rulesNote: 'Removal also counts counterspells. Lands don’t count as functions: a land that draws a card doesn’t go toward the draw quota. Two-card combos, extra turns and mass land denial are left to Commander Spellbook, at the end.',
    budgetTitle: 'The budget',
    budgetLead: 'The budget is a target: the generator tries to get close to it without going over, spending the money on the cards that make the deck better.',
    budgetRules: [
      ['Over budget', 'The card that gives the least per dollar (low score, high price) goes first, and the highest-scoring cheaper card that does the same thing goes in. An expensive land becomes a basic.'],
      ['Money left', 'Better cards that fit what’s left go in: those left out by the per-card cap and those that decks one bracket above yours run much more. The cards that define the theme stay.'],
      ['When it stops', 'When it gets close to the budget, or when no better card fits. If the best options are cheap, the deck comes out cheaper.'],
    ],
    budgetSimTitle: 'Try a budget',
    budget: 'Budget',
    startsFrom: 'Starts from',
    cheapDecks: 'the commander’s cheapest decks',
    allDecks: 'the commander’s decks at every price',
    cardCap: 'One card can cost up to',
    improvesUntil: 'With money left, it improves the deck up to',
    pricesNote: 'Prices are each card’s cheapest printing on Scryfall, in US dollars, and change every day.',
    ownedTitle: 'Only with your cards',
    ownedLead: 'In “Use my cards”, the candidates come from the precons you marked and the decks you built.',
    ownedPoints: [
      'Your cards come before the others, even with a lower score.',
      `If they’re not enough for every slot, others up to ${money(OWNED_FILL_CAP, 'USD', 'en-US', true)} go in, and the finished deck lists what you’re missing.`,
      'Lands you don’t own don’t go in: basics complete the mana.',
      'There’s no budget: the deck uses what you already own.',
    ],
    aiTitle: 'The AI (when it’s on)',
    aiLead: 'The AI doesn’t pick the deck’s cards: the building is the same with or without it. It helps with two things.',
    ai: [
      ['Describe your deck', 'Reads the sentence and turns it into choices: commander, colors, themes, budget, bracket and cards in or out. Every name it returns is checked on Scryfall and EDHREC before it counts. Without the AI, the site reads the sentence with simple rules.'],
      ['Play guide', 'With the deck ready, it writes a short guide: the first turns, the plan and what to watch out for. The cards it names as the ones that win are checked against the list.'],
    ],
    aiNote: 'Only the typed text or the card list goes out, nothing from your account. Each account has a daily limit of requests, shown at the top of the generator.',
    notesTitle: 'Good to know',
    notes: [
      'The generator doesn’t read the cards’ text to understand combos and interactions: it trusts what the community plays. Review the deck before playing.',
      'A new commander with few decks on EDHREC gives a less tuned deck. With no decks at all, the generator uses the most played cards in the commander’s colors.',
      'Card functions (ramp, draw, removal) come from Scryfall’s tags and can miss a card here and there.',
      'Generating again with the same choices gives a similar deck: to mix it up, change the themes, the bracket or the budget, or use “Cards that must be in” and “Cards to leave out”.',
    ],
    faqTitle: 'Common questions',
    faq: [
      ['Why did my deck come out much cheaper than the budget?', 'The generator only spends on cards that make the deck better. If the best options for your commander and bracket are cheap, the deck stays under the value. Brackets 1 and 2 don’t allow Game Changers, which tend to be the priciest cards.'],
      ['Why didn’t the card I wanted go in?', 'It may be a Game Changer (not allowed in brackets 1 and 2, up to 3 in bracket 3), cost more than the per-card cap, be outside the colors or have a low score. To be sure, put it in “Cards that must be in”: those always go in.'],
      ['Is the deck legal in Commander?', 'Yes: 100 cards, one copy of each (except basics), all in the commander’s colors and legal in the format. The bracket is estimated by Commander Spellbook and shows on the finished deck.'],
      ['Can I change the deck afterwards?', 'Yes. “Open in the deckbuilder” takes the deck there so you can edit it card by card, and the next cards in line are already in the maybeboard.'],
    ],
    open: 'Generate a deck',
  },
}

type Copy = (typeof COPY)['pt']

function Section({ id, icon, title, lead, children }: { id: string; icon: ReactNode; title: string; lead?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-5">
      <div className="space-y-1">
        <h2 id={id} className="flex items-center gap-2 font-display text-2xl text-parchment sm:text-3xl">
          <span className="text-gold">{icon}</span>
          {title}
        </h2>
        {lead && <p className="max-w-3xl text-parchment/70">{lead}</p>}
      </div>
      {children}
    </section>
  )
}

/** As quatro fontes: o que cada uma faz */
function Sources({ c }: { c: Copy }) {
  const icons = [Users, Database, Server, ShieldCheck]
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {c.sources.map(([name, site, text], i) => {
        const Icon = icons[i]
        return (
          <div key={name} className="rounded-xl border border-line bg-surface/60 p-4">
            <p className="flex items-center gap-2 font-semibold text-gold">
              <Icon className="h-5 w-5" aria-hidden />
              {name}
              <span className="text-xs font-normal text-parchment/40">{site}</span>
            </p>
            <p className="mt-1 text-sm text-parchment/70">{text}</p>
          </div>
        )
      })}
    </div>
  )
}

/** Os sete passos, na ordem da tela de montagem, ligados por uma linha */
function Steps({ c }: { c: Copy }) {
  const icons = [Crown, Users, ClipboardList, Sparkles, Mountain, Wallet, Gauge]
  return (
    <ol className="relative space-y-3 before:absolute before:top-4 before:bottom-4 before:left-[1.15rem] before:w-px before:bg-line">
      {c.steps.map(([title, text], i) => {
        const Icon = icons[i]
        return (
          <li key={title} className="relative flex gap-4">
            <span className="relative z-10 grid h-9 w-9 shrink-0 place-items-center rounded-full border border-gold/50 bg-ink text-gold">
              <Icon className="h-4 w-4" aria-hidden />
            </span>
            <div className="flex-1 rounded-xl border border-line bg-surface/60 p-4">
              <p className="font-semibold text-parchment">
                <span className="mr-2 font-display text-gold/60 tabular-nums">{i + 1}</span>
                {title}
              </p>
              <p className="mt-1 text-sm text-parchment/70">{text}</p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

/** Simulador da nota: com ou sem tema, os três números do EDHREC e exemplos prontos */
function ScoreSimulator({ c, locale }: { c: Copy; locale: string }) {
  const [themed, setThemed] = useState(true)
  const [values, setValues] = useState({ theme: 65, base: 25, synergy: 45 })
  const { score } = cardScore(values.base / 100, themed ? [values.theme / 100] : [], values.synergy / 100)
  const points = Math.round(score * 100)
  const sliders: [keyof typeof values, string][] = [
    ['theme', c.inTheme],
    ['base', c.inCommander],
    ['synergy', c.synergy],
  ]
  const toggle = (on: boolean) => `rounded-md px-3 py-1 ${on ? 'bg-parchment/15 text-parchment' : 'text-parchment/50 hover:text-parchment'}`
  return (
    <div className="rounded-xl border border-gold/40 bg-gold/[0.04] p-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="font-semibold text-parchment">{c.simTitle}</p>
          <p className="text-sm text-parchment/60">{c.simText}</p>
        </div>
        <div role="tablist" className="flex gap-1 rounded-lg border border-line bg-ink p-1 text-xs font-semibold">
          <button role="tab" aria-selected={themed} onClick={() => setThemed(true)} className={toggle(themed)}>
            {c.withTheme}
          </button>
          <button role="tab" aria-selected={!themed} onClick={() => setThemed(false)} className={toggle(!themed)}>
            {c.withoutTheme}
          </button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {c.presets.map(([name, theme, base, synergy]) => (
          <button
            key={name}
            type="button"
            onClick={() => setValues({ theme, base, synergy })}
            className="rounded-full border border-line px-3 py-1 text-xs font-semibold text-parchment/70 transition hover:border-gold/60 hover:text-gold"
          >
            {name}
          </button>
        ))}
      </div>
      <ul className="mt-4 space-y-3">
        {sliders.map(([key, label]) => {
          const off = key === 'theme' && !themed
          return (
            <li key={key} className={`grid grid-cols-[9rem_1fr_3rem] items-center gap-3 text-sm sm:grid-cols-[12rem_1fr_3.5rem] ${off ? 'opacity-35' : ''}`}>
              <span className="text-parchment/70">{label}</span>
              <input
                type="range"
                min={0}
                max={100}
                value={values[key]}
                disabled={off}
                onChange={(e) => setValues({ ...values, [key]: Number(e.target.value) })}
                aria-label={label}
                className="w-full accent-[#ecb93f]"
              />
              <span className="text-right text-parchment tabular-nums">{values[key]}%</span>
            </li>
          )
        })}
      </ul>
      <div className="mt-4 flex items-center gap-3">
        <span className="text-sm font-semibold text-parchment/70">{c.score}</span>
        <div className="h-3 flex-1 overflow-hidden rounded-full bg-parchment/10">
          <div className="h-full rounded-full bg-gold transition-[width]" style={{ width: `${points}%` }} />
        </div>
        <span className="w-12 text-right font-display text-3xl text-gold tabular-nums">{points.toLocaleString(locale)}</span>
      </div>
    </div>
  )
}

/** Tabela: cada bracket com as cotas de função, Game Changers e tutores */
function RulesTable({ c }: { c: Copy }) {
  const limit = (n: number) => (n === Infinity ? c.free : n === 0 ? c.none : c.upTo.replace('{n}', String(n)))
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface/60 p-4">
      <table className="w-full min-w-[34rem] text-sm">
        <thead>
          <tr className="text-left text-xs text-parchment/50">
            {c.cols.map((col, i) => (
              <th key={col} className={`py-1.5 font-semibold ${i > 0 ? 'text-center' : ''}`}>
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {[1, 2, 3, 4, 5].map((b) => (
            <tr key={b}>
              <td className="py-2 font-semibold text-parchment">
                <span className="mr-1.5 font-display text-gold">{b}</span>
                {BRACKET_NAMES[b]}
              </td>
              {ROLE_ORDER.map((role) => (
                <td key={role} className="py-2 text-center text-parchment/80 tabular-nums">
                  {ROLE_TARGETS[b][role]}+
                </td>
              ))}
              <td className="py-2 text-center text-parchment/80">{limit(GAME_CHANGERS[b])}</td>
              <td className="py-2 text-center text-parchment/80">{b <= 2 ? limit(FEW_TUTORS) : c.free}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Simulador do orçamento: de onde parte, o teto por carta e até onde melhora */
function BudgetSimulator({ c, locale }: { c: Copy; locale: string }) {
  const [budget, setBudget] = useState(150)
  const cheap = budget <= LOW_BUDGET
  const usd = (n: number) => money(n, 'USD', locale, n >= 10 || Number.isInteger(n))
  const rows: [string, string][] = [
    [c.startsFrom, cheap ? c.cheapDecks : c.allDecks],
    [c.cardCap, usd(Math.max(3, budget * CARD_SHARE))!],
    [c.improvesUntil, usd(budget * UPGRADE_UNTIL)!],
  ]
  return (
    <div className="rounded-xl border border-gold/40 bg-gold/[0.04] p-4">
      <p className="font-semibold text-parchment">{c.budgetSimTitle}</p>
      <div className="mt-3 grid grid-cols-[6rem_1fr_5rem] items-center gap-3 text-sm sm:grid-cols-[8rem_1fr_6rem]">
        <span className="text-parchment/70">{c.budget}</span>
        <input
          type="range"
          min={20}
          max={1000}
          step={10}
          value={budget}
          onChange={(e) => setBudget(Number(e.target.value))}
          aria-label={c.budget}
          className="w-full accent-[#ecb93f]"
        />
        <span className="text-right font-display text-2xl text-gold tabular-nums">{money(budget, 'USD', locale, true)}</span>
      </div>
      <dl className="mt-4 grid gap-2 sm:grid-cols-3">
        {rows.map(([label, value]) => (
          <div key={label} className="rounded-lg border border-line bg-ink/60 p-3">
            <dt className="text-xs text-parchment/50">{label}</dt>
            <dd className="mt-0.5 font-semibold text-parchment">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-parchment/45">{c.pricesNote}</p>
    </div>
  )
}

export default function GeneratorHelpPage() {
  const { locale } = useI18n()
  const c: Copy = locale.startsWith('pt') ? COPY.pt : COPY.en
  useTitle(c.title)
  const card = 'rounded-xl border border-line bg-surface/60 p-4'
  return (
    <article className="mx-auto max-w-5xl space-y-16 pb-16">
      <header className="space-y-3">
        <Link to="/my-pool/generate" className="inline-flex items-center gap-1.5 text-sm text-parchment/60 hover:text-gold">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {c.back}
        </Link>
        <h1 className="font-display text-4xl text-parchment sm:text-5xl">{c.title}</h1>
        <p className="max-w-3xl text-lg text-parchment/70">{c.lead}</p>
      </header>

      <Section id="sources" icon={<Database className="h-6 w-6" />} title={c.sourcesTitle} lead={c.sourcesLead}>
        <Sources c={c} />
      </Section>

      <Section id="steps" icon={<ListChecks className="h-6 w-6" />} title={c.stepsTitle} lead={c.stepsLead}>
        <Steps c={c} />
      </Section>

      <Section id="score" icon={<Sigma className="h-6 w-6" />} title={c.scoreTitle} lead={c.scoreLead}>
        <div className="grid gap-3 sm:grid-cols-3">
          {c.scoreParts.map(([title, text]) => (
            <div key={title} className={card}>
              <p className="font-semibold text-gold">{title}</p>
              <p className="mt-1 text-sm text-parchment/70">{text}</p>
            </div>
          ))}
        </div>
        <div className="space-y-1 rounded-xl border border-line bg-ink/60 p-4">
          <p className="font-display text-xl text-parchment">{c.formula}</p>
          <p className="text-sm text-parchment/60">{c.formulaPlain}</p>
          <p className="text-sm text-parchment/60">{c.formulaMulti}</p>
        </div>
        <ScoreSimulator c={c} locale={locale} />
        <p className="max-w-3xl text-sm text-parchment/60">{c.scoreNote}</p>
      </Section>

      <Section id="rules" icon={<Layers className="h-6 w-6" />} title={c.rulesTitle} lead={c.rulesLead}>
        <RulesTable c={c} />
        <p className="max-w-3xl text-sm text-parchment/60">{c.rulesNote}</p>
      </Section>

      <Section id="budget" icon={<Wallet className="h-6 w-6" />} title={c.budgetTitle} lead={c.budgetLead}>
        <div className="grid gap-3 md:grid-cols-3">
          {c.budgetRules.map(([title, text]) => (
            <div key={title} className={card}>
              <p className="font-semibold text-parchment">{title}</p>
              <p className="mt-1 text-sm text-parchment/70">{text}</p>
            </div>
          ))}
        </div>
        <BudgetSimulator c={c} locale={locale} />
      </Section>

      <Section id="owned" icon={<Layers className="h-6 w-6" />} title={c.ownedTitle} lead={c.ownedLead}>
        <ul className={`${card} list-disc space-y-1.5 pl-9 text-sm text-parchment/70`}>
          {c.ownedPoints.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </Section>

      <Section id="ai" icon={<Bot className="h-6 w-6" />} title={c.aiTitle} lead={c.aiLead}>
        <div className="grid gap-3 sm:grid-cols-2">
          {c.ai.map(([title, text]) => (
            <div key={title} className={card}>
              <p className="font-semibold text-gold">{title}</p>
              <p className="mt-1 text-sm text-parchment/70">{text}</p>
            </div>
          ))}
        </div>
        <p className="max-w-3xl text-sm text-parchment/60">{c.aiNote}</p>
      </Section>

      <Section id="notes" icon={<ShieldCheck className="h-6 w-6" />} title={c.notesTitle}>
        <ul className={`${card} list-disc space-y-1.5 pl-9 text-sm text-parchment/70`}>
          {c.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </Section>

      <Section id="faq" icon={<CircleHelp className="h-6 w-6" />} title={c.faqTitle}>
        <div className="space-y-2">
          {c.faq.map(([q, a]) => (
            <details key={q} className={card}>
              <summary className="cursor-pointer font-semibold text-parchment">{q}</summary>
              <p className="mt-2 text-sm text-parchment/70">{a}</p>
            </details>
          ))}
        </div>
      </Section>

      <Link
        to="/my-pool/generate"
        className="inline-flex items-center gap-2 rounded-md btn-ember px-5 py-2.5 font-display text-xl tracking-wide text-ink hover:brightness-110"
      >
        <WandSparkles className="h-5 w-5" aria-hidden />
        {c.open}
      </Link>
    </article>
  )
}
