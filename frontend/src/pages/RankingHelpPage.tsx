import { useState, type ReactNode } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, CalendarDays, Crown, Dices, Swords, Trophy, Users } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useTitle } from '../hooks/useTitle'
import { useI18n } from '../lib/i18n'
import { MIN_GAMES, RATED_MIN, SEASON_MIN_WINS, START_RATING, K, playGame, winChance } from '../lib/rating'

/*
 * Como o ranking funciona (/ranking/how-it-works): de onde vêm as partidas, o que cada quadro
 * conta, a conta do Rating (com desenho, tabela e simulador) e a temporada do mês. Texto longo,
 * escrito por idioma (como a página de privacidade); os números vêm de lib/rating.ts, o mesmo
 * cálculo do servidor.
 */

const COPY = {
  pt: {
    title: 'Como o ranking funciona',
    lead: 'Tudo o que aparece no Ranking vem das partidas em que alguém marcou quem ganhou. Aqui está de onde elas vêm, o que cada quadro conta e como o Rating sobe e desce.',
    back: 'Voltar ao Ranking',
    sourcesTitle: 'De onde vêm as partidas',
    dealt: 'Decks sorteados',
    dealtText: 'Partidas de um sorteio ou de uma sala: o vencedor é marcado na página do sorteio, na sala ou na mesa que veio do sorteio.',
    tables: 'Partidas na mesa',
    tablesText: 'Mesas abertas sem sorteio: quem termina a partida usa “Encerrar partida” e marca o vencedor.',
    filters: 'Depois você escolhe o tamanho da partida',
    filtersText: 'Cada quadro pode mostrar todas as partidas juntas ou só as de 2, 3 ou 4+ jogadores (4+ inclui ligas com 5 na mesa).',
    boardsArrow: 'e os quadros contam só essas partidas',
    notCounted: 'Não contam: partidas sem vencedor marcado e as mesas de treino.',
    all: 'Todas',
    players: '{n} jogadores',
    boardsTitle: 'Os quadros de contagem',
    boardsLead: 'Quatro quadros só contam vitórias e partidas, sem pontos.',
    boards: [
      ['Mais vitórias', 'Os decks (precons e da pool) que mais ganharam.', 'pelo menos 1 vitória'],
      ['Melhor taxa de vitória', 'Vitórias divididas pelas partidas jogadas.', `pelo menos ${MIN_GAMES} partidas`],
      ['Mais azarados', 'Decks que ganham menos que a média da mesa (numa mesa de 4, a média é perto de 25%).', `pelo menos ${MIN_GAMES} partidas`],
      ['Jogadores', 'Contas com mais vitórias. No empate, fica na frente quem precisou de menos partidas.', 'só quem tem conta'],
    ],
    ratingTitle: 'O Rating: a pontuação',
    ratingLead: 'O Rating é parecido com o do xadrez (Elo): além de quantas vezes você ganhou, conta de quem você ganhou.',
    steps: [
      ['Todo mundo começa com', `${START_RATING} pontos`],
      ['Cada partida vira duelos', 'o vencedor contra cada um que perdeu'],
      ['Cada duelo vale até', `${K} pontos ÷ número de adversários`],
    ],
    stepsNote: 'Entre os que perderam nada muda: a partida não diz quem foi melhor entre eles. Quem perde um duelo perde exatamente o que o vencedor ganhou.',
    exampleTitle: 'Exemplo: uma mesa de 4',
    exampleText: 'O jogador de 1500 ganhou de três adversários. Ganhar do mais forte (1700) rendeu mais; ganhar do mais fraco (1300) rendeu pouco, porque já era esperado.',
    winner: 'Vencedor',
    total: 'Total do vencedor',
    surpriseTitle: 'Quanto vale uma vitória num 1 contra 1',
    surpriseText: 'Antes de cada duelo o sistema calcula a chance que o vencedor tinha. Quanto mais improvável a vitória, mais pontos.',
    diff: 'Diferença de rating',
    chance: 'Chance de ganhar',
    points: 'Pontos ganhos',
    diffLabels: ['200 abaixo', '100 abaixo', 'iguais', '100 acima', '200 acima'],
    simTitle: 'Teste você mesmo',
    simText: 'Escolha quantos jogadores e o rating de cada um. O primeiro é quem ganhou.',
    loser: 'Adversário {n}',
    notesTitle: 'Bom saber',
    notes: [
      `Para aparecer no quadro do Rating são precisas ${RATED_MIN} partidas: assim três vitórias de sorte não colocam ninguém no topo.`,
      'Só contas entram, e só partidas com pelo menos 2 contas. Nomes avulsos de sorteio não contam.',
      'Cada filtro tem o seu Rating: sorteios e mesas são separados, e cada tamanho de partida também. O perfil mostra o de todas as partidas.',
      'Se alguém corrigir o vencedor de uma partida antiga, o Rating é refeito na ordem das partidas e tudo o que veio depois muda junto.',
    ],
    seasonTitle: 'A temporada do mês',
    seasonLead: 'A temporada é mais simples: conta só as vitórias do mês, somando sorteios e mesas de todos os tamanhos. Todo mês todo mundo recomeça do zero.',
    timeline: [
      ['Dia 1', 'A temporada começa com todo mundo zerado.'],
      ['Durante o mês', 'Cada vitória marcada conta no mês em que foi marcada (horário de Brasília).'],
      ['Fim do mês', `Quem mais ganhou, com pelo menos ${SEASON_MIN_WINS} vitórias, vira o campeão. No empate, quem precisou de menos partidas.`],
      ['Depois', 'O título “Campeão de [mês]” fica para sempre no perfil, e o post do campeão pode sair no Instagram (se ele autorizou o nome nos posts).'],
    ],
    faqTitle: 'Perguntas comuns',
    faq: [
      ['Ganhei mais partidas que outra pessoa e tenho menos Rating. Por quê?', 'Porque o Rating olha contra quem foram as vitórias. Ganhar várias vezes de quem está começando rende pouco; ganhar de quem tem Rating alto rende bastante.'],
      ['Perdi pontos jogando uma mesa de 4. É justo?', 'Cada duelo vale um terço numa mesa de 4. Perder uma mesa de 4 custa, no máximo, o mesmo que perder um 1 contra 1.'],
      ['Meu Rating pode cair abaixo de 1500?', 'Sim. 1500 é só o ponto de partida: quem perde mais do que ganha fica abaixo, quem ganha mais fica acima.'],
    ],
  },
  en: {
    title: 'How the ranking works',
    lead: 'Everything on the Ranking comes from games where someone marked who won. Here is where they come from, what each board counts and how the Rating goes up and down.',
    back: 'Back to the Ranking',
    sourcesTitle: 'Where the games come from',
    dealt: 'Dealt decks',
    dealtText: 'Games from a deal or a room: the winner is marked on the deal page, in the room or at the table that came from the deal.',
    tables: 'Table games',
    tablesText: 'Tables opened without a deal: whoever ends the game uses “End game” and marks the winner.',
    filters: 'Then you pick the game size',
    filtersText: 'Each board can show all games together or only 2, 3 or 4+ player games (4+ includes leagues with 5 at the table).',
    boardsArrow: 'and the boards count only those games',
    notCounted: 'Not counted: games without a marked winner and practice tables.',
    all: 'All',
    players: '{n} players',
    boardsTitle: 'The counting boards',
    boardsLead: 'Four boards only count wins and games, no points.',
    boards: [
      ['Most wins', 'The decks (precons and pool decks) that won the most.', 'at least 1 win'],
      ['Best win rate', 'Wins divided by games played.', `at least ${MIN_GAMES} games`],
      ['Unluckiest', 'Decks that win less than the table average (at a 4-player table, the average is about 25%).', `at least ${MIN_GAMES} games`],
      ['Players', 'Accounts with the most wins. On a tie, whoever needed fewer games comes first.', 'accounts only'],
    ],
    ratingTitle: 'The Rating: the score',
    ratingLead: 'The Rating works like chess Elo: besides how many times you won, it counts who you beat.',
    steps: [
      ['Everyone starts at', `${START_RATING} points`],
      ['Each game becomes duels', 'the winner against each player who lost'],
      ['Each duel is worth up to', `${K} points ÷ number of opponents`],
    ],
    stepsNote: 'Nothing changes between the players who lost: the game doesn’t say who was better among them. Whoever loses a duel loses exactly what the winner gained.',
    exampleTitle: 'Example: a 4-player table',
    exampleText: 'The 1500 player beat three opponents. Beating the strongest one (1700) was worth more; beating the weakest (1300) was worth little, because it was expected.',
    winner: 'Winner',
    total: 'Winner’s total',
    surpriseTitle: 'What a one-on-one win is worth',
    surpriseText: 'Before each duel the system works out the chance the winner had. The less likely the win, the more points.',
    diff: 'Rating difference',
    chance: 'Chance to win',
    points: 'Points gained',
    diffLabels: ['200 below', '100 below', 'equal', '100 above', '200 above'],
    simTitle: 'Try it yourself',
    simText: 'Pick how many players and each one’s rating. The first one is the winner.',
    loser: 'Opponent {n}',
    notesTitle: 'Good to know',
    notes: [
      `You need ${RATED_MIN} games to show up on the Rating board, so three lucky wins don’t put anyone on top.`,
      'Only accounts count, and only games with at least 2 accounts. Loose names from deals don’t count.',
      'Each filter has its own Rating: deals and tables are separate, and so is each game size. Profiles show the one for all games.',
      'If someone fixes the winner of an old game, the Rating is redone in game order and everything after it changes too.',
    ],
    seasonTitle: 'The monthly season',
    seasonLead: 'The season is simpler: it only counts wins in the month, adding deals and tables of every size. Every month everyone starts from zero.',
    timeline: [
      ['Day 1', 'The season starts with everyone at zero.'],
      ['During the month', 'Each marked win counts in the month it was marked (Brasília time).'],
      ['End of the month', `Whoever won the most, with at least ${SEASON_MIN_WINS} wins, becomes the champion. On a tie, whoever needed fewer games.`],
      ['After', 'The “[Month] champion” title stays on the profile forever, and the champion post can go out on Instagram (if they allowed their name in posts).'],
    ],
    faqTitle: 'Common questions',
    faq: [
      ['I won more games than someone and have a lower Rating. Why?', 'Because the Rating looks at who you beat. Beating beginners many times is worth little; beating high-rated players is worth a lot.'],
      ['I lost points at a 4-player table. Is that fair?', 'Each duel is worth a third at a 4-player table. Losing a 4-player game costs at most the same as losing a one-on-one.'],
      ['Can my Rating go below 1500?', 'Yes. 1500 is just the starting point: whoever loses more than they win goes below it, whoever wins more goes above.'],
    ],
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

const fmt = (n: number, locale: string, digits = 1) =>
  n.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits })
const signed = (n: number, locale: string) => `${n >= 0 ? '+' : '−'}${fmt(Math.abs(n), locale)}`

/** Das partidas aos quadros: as duas fontes, o filtro de tamanho e os quadros */
function SourcesFlow({ c }: { c: Copy }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {(
          [
            [<Dices key="d" className="h-5 w-5" />, c.dealt, c.dealtText],
            [<Swords key="s" className="h-5 w-5" />, c.tables, c.tablesText],
          ] as const
        ).map(([icon, title, text]) => (
          <div key={title} className="rounded-xl border border-line bg-surface/60 p-4">
            <p className="flex items-center gap-2 font-semibold text-gold">
              {icon}
              {title}
            </p>
            <p className="mt-1 text-sm text-parchment/70">{text}</p>
          </div>
        ))}
      </div>
      <ArrowDown className="mx-auto h-5 w-5 text-parchment/30" aria-hidden />
      <div className="rounded-xl border border-line bg-surface/60 p-4 text-center">
        <p className="font-semibold text-parchment">{c.filters}</p>
        <div className="mx-auto mt-2 flex w-fit flex-wrap justify-center gap-1 rounded-lg border border-line bg-ink p-1 text-xs font-semibold">
          {[c.all, c.players.replace('{n}', '2'), c.players.replace('{n}', '3'), c.players.replace('{n}', '4+')].map((label, i) => (
            <span key={label} className={`rounded-md px-3 py-1 ${i === 0 ? 'bg-parchment/15 text-parchment' : 'text-parchment/50'}`}>
              {label}
            </span>
          ))}
        </div>
        <p className="mt-2 text-sm text-parchment/60">{c.filtersText}</p>
      </div>
      <p className="flex items-center justify-center gap-2 text-sm text-parchment/50">
        <ArrowDown className="h-4 w-4" aria-hidden />
        {c.boardsArrow}
      </p>
      <p className="text-center text-xs text-parchment/45">{c.notCounted}</p>
    </div>
  )
}

/** Uma mesa de 4: o vencedor em cima, os três que perderam embaixo, com os pontos de cada duelo */
function DuelDiagram({ c, locale }: { c: Copy; locale: string }) {
  const winner = 1500
  const losers = [1700, 1500, 1300]
  const { gain, losses } = playGame(winner, losers)
  const W = 600
  const H = 300
  const top = { x: W / 2, y: 62 }
  const bottom = losers.map((_, i) => ({ x: 110 + i * 190, y: 236 }))
  return (
    <figure className="rounded-xl border border-line bg-surface/60 p-4">
      <figcaption className="mb-1 font-semibold text-parchment">{c.exampleTitle}</figcaption>
      <p className="mb-3 text-sm text-parchment/60">{c.exampleText}</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto w-full max-w-2xl" role="img" aria-label={c.exampleTitle}>
        {bottom.map((b, i) => {
          const mx = (top.x + b.x) / 2
          const my = (top.y + b.y) / 2
          return (
            <g key={i}>
              <line x1={b.x} y1={b.y - 34} x2={top.x} y2={top.y + 36} stroke="currentColor" strokeWidth={2} className="text-parchment/25" />
              <rect x={mx - 34} y={my - 13} width={68} height={26} rx={13} className="fill-ink stroke-line" strokeWidth={1} />
              <text x={mx} y={my + 5} textAnchor="middle" className="fill-emerald-300 text-[14px] font-semibold tabular-nums">
                {signed(-losses[i], locale)}
              </text>
            </g>
          )
        })}
        <circle cx={top.x} cy={top.y} r={36} className="fill-gold/15 stroke-gold" strokeWidth={2} />
        <text x={top.x} y={top.y - 4} textAnchor="middle" className="fill-gold text-[12px] font-semibold uppercase">
          {c.winner}
        </text>
        <text x={top.x} y={top.y + 15} textAnchor="middle" className="fill-parchment text-[16px] font-semibold tabular-nums">
          {winner}
        </text>
        <text x={top.x + 50} y={top.y + 5} className="fill-emerald-300 text-[15px] font-semibold tabular-nums">
          {c.total}: {signed(gain, locale)}
        </text>
        {bottom.map((b, i) => (
          <g key={i}>
            <circle cx={b.x} cy={b.y} r={32} className="fill-ink stroke-parchment/30" strokeWidth={2} />
            <text x={b.x} y={b.y + 6} textAnchor="middle" className="fill-parchment text-[16px] font-semibold tabular-nums">
              {losers[i]}
            </text>
            <text x={b.x} y={b.y + 52} textAnchor="middle" className="fill-red-300 text-[14px] font-semibold tabular-nums">
              {signed(losses[i], locale)}
            </text>
          </g>
        ))}
      </svg>
    </figure>
  )
}

/** Tabela: diferença de rating → chance → pontos, num 1 contra 1 */
function SurpriseTable({ c, locale }: { c: Copy; locale: string }) {
  const diffs = [-200, -100, 0, 100, 200]
  return (
    <div className="rounded-xl border border-line bg-surface/60 p-4">
      <p className="font-semibold text-parchment">{c.surpriseTitle}</p>
      <p className="mb-3 text-sm text-parchment/60">{c.surpriseText}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-parchment/50">
              <th className="py-1.5 font-semibold">{c.diff}</th>
              <th className="py-1.5 font-semibold">{c.chance}</th>
              <th className="py-1.5 text-right font-semibold">{c.points}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {diffs.map((d, i) => {
              const chance = winChance(START_RATING + d, START_RATING)
              return (
                <tr key={d}>
                  <td className="py-2 text-parchment/80">{c.diffLabels[i]}</td>
                  <td className="py-2">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-16 overflow-hidden rounded-full bg-parchment/10 sm:w-32">
                        <div className="h-full rounded-full bg-gold" style={{ width: `${chance * 100}%` }} />
                      </div>
                      <span className="text-parchment/70 tabular-nums">{Math.round(chance * 100)}%</span>
                    </div>
                  </td>
                  <td className="py-2 text-right font-semibold text-emerald-300 tabular-nums">
                    {signed(K * (1 - chance), locale)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** Simulador: quantos jogadores e o rating de cada um; mostra quanto cada um ganha ou perde */
function Simulator({ c, locale }: { c: Copy; locale: string }) {
  const [ratings, setRatings] = useState([1500, 1600, 1450, 1500])
  const [size, setSize] = useState(4)
  const shown = ratings.slice(0, size)
  const { gain, losses } = playGame(shown[0], shown.slice(1))
  const set = (i: number, v: number) => setRatings(ratings.map((r, k) => (k === i ? v : r)))
  return (
    <div className="rounded-xl border border-gold/40 bg-gold/[0.04] p-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="font-semibold text-parchment">{c.simTitle}</p>
          <p className="text-sm text-parchment/60">{c.simText}</p>
        </div>
        <div role="tablist" className="flex gap-1 rounded-lg border border-line bg-ink p-1 text-xs font-semibold">
          {[2, 3, 4].map((n) => (
            <button
              key={n}
              role="tab"
              aria-selected={size === n}
              onClick={() => setSize(n)}
              className={`rounded-md px-3 py-1 ${size === n ? 'bg-parchment/15 text-parchment' : 'text-parchment/50 hover:text-parchment'}`}
            >
              {c.players.replace('{n}', String(n))}
            </button>
          ))}
        </div>
      </div>
      <ul className="mt-4 space-y-3">
        {shown.map((r, i) => {
          const delta = i === 0 ? gain : losses[i - 1]
          return (
            <li key={i} className="grid grid-cols-[6rem_1fr_2.5rem_3.5rem] items-center gap-2 text-sm sm:grid-cols-[7.5rem_1fr_3.5rem_4.5rem] sm:gap-3">
              <span className={`flex items-center gap-1.5 truncate ${i === 0 ? 'font-semibold text-gold' : 'text-parchment/70'}`}>
                {i === 0 && <Crown className="h-4 w-4 shrink-0" aria-hidden />}
                {i === 0 ? c.winner : c.loser.replace('{n}', String(i))}
              </span>
              <input
                type="range"
                min={1100}
                max={1900}
                step={10}
                value={r}
                onChange={(e) => set(i, Number(e.target.value))}
                aria-label={i === 0 ? c.winner : c.loser.replace('{n}', String(i))}
                className="w-full accent-[#ecb93f]"
              />
              <span className="text-right text-parchment tabular-nums">{r}</span>
              <span className={`text-right font-semibold tabular-nums ${delta >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                {signed(delta, locale)}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** A temporada: do dia 1 ao título no perfil */
function SeasonTimeline({ c }: { c: Copy }) {
  const icons = [CalendarDays, Trophy, Crown, Users]
  return (
    <ol className="grid gap-3 md:grid-cols-4">
      {c.timeline.map(([title, text], i) => {
        const Icon = icons[i]
        return (
          <li key={title} className="relative rounded-xl border border-line bg-surface/60 p-4">
            <span className="mb-2 flex h-9 w-9 items-center justify-center rounded-full border border-gold/50 bg-gold/10 text-gold">
              <Icon className="h-4 w-4" aria-hidden />
            </span>
            <p className="font-semibold text-parchment">{title}</p>
            <p className="mt-1 text-sm text-parchment/65">{text}</p>
            {i < c.timeline.length - 1 && (
              <ArrowRight className="absolute top-1/2 -right-3 hidden h-4 w-4 -translate-y-1/2 text-parchment/30 md:block" aria-hidden />
            )}
          </li>
        )
      })}
    </ol>
  )
}

export default function RankingHelpPage() {
  const { locale } = useI18n()
  const c: Copy = locale.startsWith('pt') ? COPY.pt : COPY.en
  useTitle(c.title)
  return (
    <article className="mx-auto max-w-5xl space-y-16 pb-16">
      <header className="space-y-3">
        <Link to="/ranking" className="inline-flex items-center gap-1.5 text-sm text-parchment/60 hover:text-gold">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {c.back}
        </Link>
        <h1 className="font-display text-4xl text-parchment sm:text-5xl">{c.title}</h1>
        <p className="max-w-3xl text-lg text-parchment/70">{c.lead}</p>
      </header>

      <Section id="sources" icon={<Dices className="h-6 w-6" />} title={c.sourcesTitle}>
        <SourcesFlow c={c} />
      </Section>

      <Section id="boards" icon={<Trophy className="h-6 w-6" />} title={c.boardsTitle} lead={c.boardsLead}>
        <div className="grid gap-3 sm:grid-cols-2">
          {c.boards.map(([title, text, min]) => (
            <div key={title} className="rounded-xl border border-line bg-surface/60 p-4">
              <p className="font-display text-xl text-parchment">{title}</p>
              <p className="mt-1 text-sm text-parchment/70">{text}</p>
              <span className="mt-3 inline-block rounded-full border border-line px-2.5 py-0.5 text-xs text-parchment/55">{min}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section id="rating" icon={<Swords className="h-6 w-6" />} title={c.ratingTitle} lead={c.ratingLead}>
        <ol className="grid gap-3 sm:grid-cols-3">
          {c.steps.map(([label, value], i) => (
            <li key={label} className="rounded-xl border border-line bg-surface/60 p-4">
              <span className="font-display text-3xl text-gold/60">{i + 1}</span>
              <p className="text-sm text-parchment/60">{label}</p>
              <p className="font-semibold text-parchment">{value}</p>
            </li>
          ))}
        </ol>
        <p className="max-w-3xl text-sm text-parchment/60">{c.stepsNote}</p>
        <DuelDiagram c={c} locale={locale} />
        <SurpriseTable c={c} locale={locale} />
        <Simulator c={c} locale={locale} />
        <div className="rounded-xl border border-line bg-surface/60 p-4">
          <p className="mb-2 font-semibold text-parchment">{c.notesTitle}</p>
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-parchment/70">
            {c.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      </Section>

      <Section id="season" icon={<CalendarDays className="h-6 w-6" />} title={c.seasonTitle} lead={c.seasonLead}>
        <SeasonTimeline c={c} />
      </Section>

      <Section id="faq" icon={<Users className="h-6 w-6" />} title={c.faqTitle}>
        <div className="space-y-2">
          {c.faq.map(([q, a]) => (
            <details key={q} className="rounded-xl border border-line bg-surface/60 p-4">
              <summary className="cursor-pointer font-semibold text-parchment">{q}</summary>
              <p className="mt-2 text-sm text-parchment/70">{a}</p>
            </details>
          ))}
        </div>
      </Section>

      <Link
        to="/ranking"
        className="inline-flex items-center gap-2 rounded-md btn-ember px-5 py-2.5 font-display text-xl tracking-wide text-ink hover:brightness-110"
      >
        <Trophy className="h-5 w-5" aria-hidden />
        {c.back}
      </Link>
    </article>
  )
}
