import { useEffect, useMemo, useRef, useState } from 'react'
import { Crown, ShieldCheck, Sun } from 'lucide-react'
import type { LogItem } from '../../hooks/useTableSocket'
import { useT } from '../../lib/i18n'

/*
 * Dado e moeda no meio da mesa, para todos. O resultado vem do servidor (ação "roll" no registro);
 * aqui é só o espetáculo, que sempre termina no número sorteado. A variante (o jeito de jogar, a
 * cor do dado, a moeda) sai do número da entrada no registro, então todos na mesa veem a mesma.
 *
 * Dados: d6 é um cubo 3D com pontos; os outros são o desenho do dado (d4, d8, d10, d12, d20 ou uma
 * gema para os personalizados) com os números correndo até parar. Quatro jeitos de jogar (rolando
 * de lado, caindo do alto, redemoinho e chacoalhar e bater) e cinco cores. Moeda: jogada para cima,
 * girando em pé na mesa, peteleco de lado e a "suspense", que quase cai do outro lado.
 */

const HOLD_MS = 1700 // o resultado fica parado na tela depois de cair

type Theme = { light: string; dark: string; edge: string; ink: string; pip1?: string }
const THEMES: Theme[] = [
  { light: '#fbf4e0', dark: '#d6c9a6', edge: '#8a7a55', ink: '#1d1a14', pip1: '#b3261e' }, // marfim
  { light: '#ef6b6f', dark: '#7d1420', edge: '#3d070d', ink: '#fff3e0' }, // rubi
  { light: '#4a4a56', dark: '#111116', edge: '#c9a24a', ink: '#ecc96a' }, // obsidiana e ouro
  { light: '#48c993', dark: '#0f5a3e', edge: '#06281b', ink: '#f2fff8' }, // esmeralda
  { light: '#6f98ff', dark: '#1b2f78', edge: '#0b1440', ink: '#ffffff' }, // safira
]

type DieMotion = 'tumble' | 'drop' | 'vortex' | 'slam'
type CoinMotion = 'toss' | 'spin' | 'flick' | 'tense'

/** Sorteio repetível (mulberry32): mesma semente, mesma animação em todas as telas */
function seeded(seed: number) {
  let a = Math.imul(seed || 1, 2654435761) >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const reducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

const tr = (x: number, y: number, sx = 1, sy = sx) => `translate(${x}px, ${y}px) scale(${sx}, ${sy})`

type Plan = {
  duration: number
  /** fração da animação em que bate na mesa (anel de impacto) */
  impact: number
  motion: Keyframe[]
  spin: Keyframe[]
  spinEasing: string
  spinShare: number
}

function diePlan(motion: DieMotion, rand: () => number, cube: boolean, n: number): Plan {
  const W = window.innerWidth
  const H = window.innerHeight
  const dir = rand() < 0.5 ? -1 : 1
  let plan: Omit<Plan, 'spin' | 'spinEasing' | 'spinShare'> & { turns: number }
  if (motion === 'tumble') {
    const x0 = dir * Math.min(W * 0.42, 560)
    plan = {
      duration: 1900,
      impact: 0.32,
      turns: 3,
      motion: [
        { offset: 0, transform: tr(x0, -60, 0.9), opacity: 0, easing: 'ease-in' },
        { offset: 0.08, opacity: 1 },
        { offset: 0.32, transform: tr(x0 * 0.55, 0), easing: 'ease-out' },
        { offset: 0.47, transform: tr(x0 * 0.32, -80, 1.05), easing: 'ease-in' },
        { offset: 0.62, transform: tr(x0 * 0.14, 0), easing: 'ease-out' },
        { offset: 0.74, transform: tr(x0 * 0.05, -28), easing: 'ease-in' },
        { offset: 0.86, transform: tr(0, 0), easing: 'ease-out' },
        { offset: 1, transform: tr(0, 0), opacity: 1 },
      ],
    }
  } else if (motion === 'drop') {
    plan = {
      duration: 1800,
      impact: 0.4,
      turns: 2,
      motion: [
        { offset: 0, transform: tr(dir * 40, -H * 0.6, 1.5), opacity: 0, easing: 'ease-in' },
        { offset: 0.1, opacity: 1 },
        { offset: 0.4, transform: tr(0, 0, 1), easing: 'ease-out' },
        { offset: 0.46, transform: tr(0, 6, 1.14, 0.84), easing: 'ease-out' },
        { offset: 0.62, transform: tr(0, -100, 0.96, 1.05), easing: 'ease-in' },
        { offset: 0.76, transform: tr(0, 0, 1), easing: 'ease-out' },
        { offset: 0.8, transform: tr(0, 3, 1.07, 0.93), easing: 'ease-out' },
        { offset: 0.9, transform: tr(0, -18, 1), easing: 'ease-in' },
        { offset: 1, transform: tr(0, 0, 1), opacity: 1 },
      ],
    }
  } else if (motion === 'vortex') {
    plan = {
      duration: 1700,
      impact: 0.72,
      turns: 5,
      motion: [
        { offset: 0, transform: tr(0, 0, 0.05), opacity: 0, filter: 'blur(10px)', easing: 'ease-out' },
        { offset: 0.15, opacity: 1 },
        { offset: 0.5, transform: tr(0, -10, 1.35), filter: 'blur(3px)', easing: 'ease-in-out' },
        { offset: 0.72, transform: tr(0, 0, 0.94), filter: 'blur(0px)', easing: 'ease-out' },
        { offset: 0.84, transform: tr(0, 0, 1.06) },
        { offset: 1, transform: tr(0, 0, 1), opacity: 1, filter: 'blur(0px)' },
      ],
    }
  } else {
    // slam: sobe, chacoalha na mão e bate na mesa
    const rattle: Keyframe[] = []
    for (let i = 0; i < 8; i++) {
      rattle.push({ offset: 0.16 + i * 0.055, transform: tr((i % 2 ? 1 : -1) * (8 + rand() * 12), -40 - rand() * 14, 1.22) })
    }
    plan = {
      duration: 1900,
      impact: 0.72,
      turns: 2,
      motion: [
        { offset: 0, transform: tr(0, 60, 0.6), opacity: 0, easing: 'ease-out' },
        { offset: 0.12, transform: tr(0, -30, 1.2), opacity: 1 },
        ...rattle,
        { offset: 0.62, transform: tr(0, -70, 1.3), easing: 'ease-in' },
        { offset: 0.72, transform: tr(0, 0, 1.12, 0.86), easing: 'ease-out' },
        { offset: 0.8, transform: tr(0, 0, 0.96, 1.04) },
        { offset: 1, transform: tr(0, 0, 1), opacity: 1 },
      ],
    }
  }
  const { turns, ...rest } = plan
  const spinShare = motion === 'slam' ? 0.8 : 0.88
  if (cube) {
    // Rodar o cubo até a face sorteada ficar de frente (ver FACE_TURN)
    const [bx, by] = FACE_TURN[n] ?? [0, 0]
    const a = turns + Math.floor(rand() * 2)
    const b = turns - 1 + Math.floor(rand() * 2)
    const z0 = dir * (180 + rand() * 360)
    return {
      ...rest,
      spinShare,
      spinEasing: 'cubic-bezier(.2,.7,.25,1)',
      spin: [
        { transform: `rotateZ(${z0}deg) rotateX(${dir * 20}deg) rotateY(${-dir * 30}deg)` },
        { transform: `rotateZ(0deg) rotateX(${dir * 360 * a + bx}deg) rotateY(${-dir * 360 * b + by}deg)` },
      ],
    }
  }
  const r0 = dir * 360 * (turns + rand())
  return {
    ...rest,
    spinShare,
    spinEasing: 'cubic-bezier(.2,.75,.25,1)',
    spin: [{ transform: `rotate(${r0}deg)` }, { transform: 'rotate(0deg)' }],
  }
}

function coinPlan(motion: CoinMotion, rand: () => number, heads: boolean): Plan {
  const W = window.innerWidth
  const H = window.innerHeight
  const dir = rand() < 0.5 ? -1 : 1
  const rot = (x: number, y = 0, z = 0) => `rotateY(${y}deg) rotateZ(${z}deg) rotateX(${x}deg)`
  const face = heads ? 0 : 180
  if (motion === 'spin') {
    // Girando em pé na mesa, cada vez mais devagar, até deitar mostrando a face
    const total = 360 * (7 + Math.floor(rand() * 3)) + face
    const z = heads ? 0 : 180
    return {
      duration: 2400,
      impact: 0.97,
      spinShare: 1,
      spinEasing: 'cubic-bezier(.08,.6,.2,1)',
      motion: [
        { offset: 0, transform: tr(0, 30, 0.5), opacity: 0, easing: 'ease-out' },
        { offset: 0.1, transform: tr(0, 0, 1.1), opacity: 1 },
        { offset: 0.3, transform: tr(-14 * dir, 0, 1.1) },
        { offset: 0.5, transform: tr(10 * dir, 0, 1.08) },
        { offset: 0.7, transform: tr(-6 * dir, 0, 1.04) },
        { offset: 0.88, transform: tr(0, 0, 1) },
        { offset: 0.95, transform: tr(0, 4, 1.04, 0.97) },
        { offset: 1, transform: tr(0, 0, 1), opacity: 1 },
      ],
      spin: [{ transform: rot(0, 0, z) }, { transform: rot(0, dir * total, z) }],
    }
  }
  if (motion === 'flick') {
    const x0 = dir * Math.min(W * 0.4, 500)
    const total = 360 * (5 + Math.floor(rand() * 3)) + face
    return {
      duration: 1900,
      impact: 0.82,
      spinShare: 0.82,
      spinEasing: 'cubic-bezier(.3,.55,.45,1)',
      motion: [
        { offset: 0, transform: tr(x0, 20, 0.85), opacity: 0, easing: 'ease-out' },
        { offset: 0.06, opacity: 1 },
        { offset: 0.45, transform: tr(x0 * 0.4, -H * 0.24, 1.3), easing: 'ease-in' },
        { offset: 0.82, transform: tr(0, 0, 1), easing: 'ease-out' },
        { offset: 0.9, transform: tr(0, -14, 1.02), easing: 'ease-in' },
        { offset: 1, transform: tr(0, 0, 1), opacity: 1 },
      ],
      spin: [{ transform: rot(0, 0, -dir * 20) }, { transform: rot(-dir * total, 0, 0) }],
    }
  }
  if (motion === 'tense') {
    // Sobe alto, desce em câmera lenta, passa da face sorteada, balança e volta
    const total = 360 * (6 + Math.floor(rand() * 2)) + face
    return {
      duration: 2700,
      impact: 0.62,
      spinShare: 1,
      spinEasing: 'linear',
      motion: [
        { offset: 0, transform: tr(0, H * 0.22, 0.7), opacity: 0, easing: 'ease-out' },
        { offset: 0.05, opacity: 1 },
        { offset: 0.34, transform: tr(0, -H * 0.32, 1.55), easing: 'ease-in' },
        { offset: 0.62, transform: tr(0, 0, 1.06), easing: 'ease-out' },
        { offset: 0.68, transform: tr(0, -22, 1.08), easing: 'ease-in' },
        { offset: 0.74, transform: tr(0, 0, 1.04) },
        { offset: 1, transform: tr(0, 0, 1), opacity: 1 },
      ],
      spin: [
        { offset: 0, transform: rot(0), easing: 'cubic-bezier(.35,0,.65,1)' },
        { offset: 0.55, transform: rot(total - 230), easing: 'ease-out' },
        { offset: 0.74, transform: rot(total - 40), easing: 'ease-in-out' },
        { offset: 0.84, transform: rot(total + 32), easing: 'ease-in-out' },
        { offset: 0.92, transform: rot(total - 10), easing: 'ease-in-out' },
        { offset: 1, transform: rot(total) },
      ],
    }
  }
  // toss: para cima com o polegar, gira no ar e cai
  const total = 360 * (6 + Math.floor(rand() * 4)) + face
  return {
    duration: 2000,
    impact: 0.8,
    spinShare: 1,
    spinEasing: 'linear',
    motion: [
      { offset: 0, transform: tr(0, H * 0.22, 0.7), opacity: 0, easing: 'ease-out' },
      { offset: 0.06, opacity: 1 },
      { offset: 0.42, transform: tr(dir * 20, -H * 0.28, 1.45), easing: 'ease-in' },
      { offset: 0.8, transform: tr(0, 0, 1), easing: 'ease-out' },
      { offset: 0.88, transform: tr(0, -16, 1.02), easing: 'ease-in' },
      { offset: 1, transform: tr(0, 0, 1), opacity: 1 },
    ],
    spin: [
      { offset: 0, transform: rot(0), easing: 'cubic-bezier(.3,.6,.5,1)' },
      { offset: 0.8, transform: rot(total) },
      { offset: 0.88, transform: rot(total + 16) },
      { offset: 1, transform: rot(total) },
    ],
  }
}

/** Rotação (X, Y) que deixa a face com esse número de frente (faces opostas somam 7) */
const FACE_TURN: Record<number, [number, number]> = { 1: [0, 0], 6: [0, 180], 3: [0, -90], 4: [0, 90], 5: [-90, 0], 2: [90, 0] }
const FACE_PLACE: [number, string][] = [
  [1, 'translateZ(var(--half))'],
  [6, 'rotateY(180deg) translateZ(var(--half))'],
  [3, 'rotateY(90deg) translateZ(var(--half))'],
  [4, 'rotateY(-90deg) translateZ(var(--half))'],
  [5, 'rotateX(90deg) translateZ(var(--half))'],
  [2, 'rotateX(-90deg) translateZ(var(--half))'],
]
const PIPS: Record<number, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] }

function Cube({ theme }: { theme: Theme }) {
  return (
    <div className="roll-cube" style={{ ['--half' as string]: '56px' }}>
      {FACE_PLACE.map(([n, place]) => (
        <div
          key={n}
          className="roll-cube-face"
          style={{
            transform: place,
            background: `radial-gradient(circle at 30% 25%, ${theme.light}, ${theme.dark})`,
            boxShadow: `inset 0 0 0 3px ${theme.edge}, inset 0 0 18px rgba(0,0,0,.35)`,
          }}
        >
          {Array.from({ length: 9 }, (_, i) => (
            <span key={i} className="grid place-items-center">
              {PIPS[n].includes(i) && (
                <span
                  className="block rounded-full"
                  style={{
                    width: n === 1 ? 26 : 18,
                    height: n === 1 ? 26 : 18,
                    background: n === 1 && theme.pip1 ? theme.pip1 : theme.ink,
                    boxShadow: 'inset 0 2px 3px rgba(0,0,0,.5)',
                  }}
                />
              )}
            </span>
          ))}
        </div>
      ))}
    </div>
  )
}

/** Desenho do dado de cada tamanho: contorno, facetas e onde vai o número */
function shapeOf(sides: number): { outline: string; facets: string[]; y: number } {
  if (sides <= 4)
    return { outline: '50,5 96,89 4,89', facets: ['50,5 50,62', '4,89 50,62', '96,89 50,62'], y: 70 }
  if (sides === 8) return { outline: '50,3 95,50 50,97 5,50', facets: ['5,50 95,50'], y: 52 }
  if (sides === 10)
    return { outline: '50,3 94,44 50,97 6,44', facets: ['6,44 50,64', '94,44 50,64', '50,64 50,97'], y: 46 }
  if (sides === 12)
    return {
      outline: '50,4 95,38 78,92 22,92 5,38',
      facets: [
        '50,28 73,45 64,72 36,72 27,45 50,28',
        '50,4 50,28',
        '95,38 73,45',
        '78,92 64,72',
        '22,92 36,72',
        '5,38 27,45',
      ],
      y: 52,
    }
  if (sides === 20)
    return {
      outline: '50,3 92,26 92,74 50,97 8,74 8,26',
      facets: ['50,22 78,70 22,70 50,22', '50,3 50,22', '92,26 78,70', '92,74 78,70', '50,97 22,70', '8,74 22,70', '8,26 22,70', '92,26 50,22', '8,26 50,22', '50,97 78,70'],
      y: 56,
    }
  return { outline: '', facets: [], y: 52 }
}

function FlatDie({ sides, value, theme, uid }: { sides: number; value: number; theme: Theme; uid: string }) {
  const { outline, facets, y } = shapeOf(sides)
  const digits = String(value).length
  const size = digits <= 2 ? 30 : digits === 3 ? 24 : 19
  return (
    <svg viewBox="0 0 100 100" className="roll-flat" aria-hidden>
      <defs>
        <radialGradient id={`g${uid}`} cx="35%" cy="28%" r="80%">
          <stop offset="0%" stopColor={theme.light} />
          <stop offset="100%" stopColor={theme.dark} />
        </radialGradient>
      </defs>
      {outline ? (
        <polygon points={outline} fill={`url(#g${uid})`} stroke={theme.edge} strokeWidth={3} strokeLinejoin="round" />
      ) : (
        <>
          <circle cx={50} cy={50} r={46} fill={`url(#g${uid})`} stroke={theme.edge} strokeWidth={3} />
          <circle cx={50} cy={50} r={34} fill="none" stroke={theme.edge} strokeOpacity={0.5} strokeWidth={1.5} />
        </>
      )}
      {facets.map((f, i) => (
        <polyline key={i} points={f} fill="none" stroke={theme.edge} strokeOpacity={0.45} strokeWidth={1.4} />
      ))}
      <text
        x={50}
        y={y}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={size}
        fontWeight={700}
        fill={theme.ink}
        stroke={theme.edge}
        strokeWidth={0.8}
        paintOrder="stroke"
        className="font-display"
      >
        {value}
      </text>
      {!outline && (
        <text x={50} y={80} textAnchor="middle" fontSize={9} fill={theme.ink} opacity={0.7}>
          d{sides}
        </text>
      )}
    </svg>
  )
}

function Coin({ heads, tails }: { heads: string; tails: string }) {
  return (
    <div className="roll-coin">
      {[-3, -2, -1, 0, 1, 2, 3].map((z) => (
        <div key={z} className="roll-coin-edge" style={{ transform: `translateZ(${z}px)` }} />
      ))}
      <div className="roll-coin-face" style={{ transform: 'translateZ(4px)' }}>
        <Sun className="h-14 w-14" strokeWidth={1.6} aria-hidden />
        <span>{heads}</span>
      </div>
      <div className="roll-coin-face" style={{ transform: 'rotateX(180deg) translateZ(4px)' }}>
        <Crown className="h-14 w-14" strokeWidth={1.6} aria-hidden />
        <span>{tails}</span>
      </div>
    </div>
  )
}

export function RollOverlay({ entry, onDone }: { entry: LogItem; onDone: () => void }) {
  const t = useT()
  const sides = entry.sides ?? 6
  const n = entry.n ?? 1
  const coin = sides === 2
  const cube = sides === 6
  const seed = entry.id ?? 0
  const still = useMemo(reducedMotion, [])
  const { plan, theme } = useMemo(() => {
    const rand = seeded(seed)
    const theme = THEMES[Math.floor(rand() * THEMES.length)]
    const plan = coin
      ? coinPlan((['toss', 'spin', 'flick', 'tense'] as const)[Math.floor(rand() * 4)], rand, n === 1)
      : diePlan((['tumble', 'drop', 'vortex', 'slam'] as const)[Math.floor(rand() * 4)], rand, cube, n)
    return { plan, theme }
  }, [seed, coin, cube, n])
  const [landed, setLanded] = useState(still)
  const [impact, setImpact] = useState(false)
  const [shown, setShown] = useState(n)
  const motionRef = useRef<HTMLDivElement>(null)
  const spinRef = useRef<HTMLDivElement>(null)

  // Corre a animação; termina no resultado e some depois de HOLD_MS
  useEffect(() => {
    const total = (still ? 0 : plan.duration) + HOLD_MS
    const done = setTimeout(onDone, total)
    if (still) return () => clearTimeout(done)
    setLanded(false)
    setImpact(false)
    const anims = [
      motionRef.current?.animate(plan.motion, { duration: plan.duration, fill: 'both' }),
      spinRef.current?.animate(plan.spin, {
        duration: plan.duration * plan.spinShare,
        easing: plan.spinEasing,
        fill: 'both',
      }),
    ]
    const hit = setTimeout(() => setImpact(true), plan.duration * plan.impact)
    const land = setTimeout(() => setLanded(true), plan.duration)
    return () => {
      clearTimeout(done)
      clearTimeout(hit)
      clearTimeout(land)
      anims.forEach((a) => a?.cancel())
    }
  }, [plan, still, onDone])

  // Números correndo no dado (decoração): cada vez mais devagar até parar no sorteado
  useEffect(() => {
    if (landed || coin || cube) {
      setShown(n)
      return
    }
    let delay = 45
    let timer = 0
    const tick = () => {
      setShown(1 + Math.floor(Math.random() * sides))
      delay *= 1.11
      timer = window.setTimeout(tick, delay)
    }
    tick()
    return () => clearTimeout(timer)
  }, [landed, coin, cube, sides, n])

  const crit = !coin && sides === 20 && (n === 20 || n === 1) ? (n === 20 ? 'high' : 'low') : null
  const max = !coin && n === sides && sides >= 4
  const glow = crit === 'low' ? '#e4572e' : '#e8c76a'
  const sparks = crit === 'high' ? 22 : max || coin ? 14 : 8

  return (
    <div className="pointer-events-none fixed inset-0 z-40 grid place-items-center bg-[radial-gradient(circle,rgba(0,0,0,.45),transparent_70%)]">
      <div className="flex flex-col items-center">
        <p className="mb-4 rounded-full bg-ink/80 px-4 py-1 text-sm text-parchment/80 shadow-lg shadow-black/50">
          {coin
            ? t('{who} flipped a coin', { who: entry.who })
            : t('{who} rolled a d{sides}', { who: entry.who, sides })}
        </p>
        <div className="relative grid h-40 w-40 place-items-center" style={{ perspective: '900px' }}>
          {/* sombra na mesa */}
          <div
            className={`absolute bottom-0 h-5 w-28 rounded-[50%] bg-black/60 blur-md transition-opacity duration-500 ${landed ? 'opacity-80' : 'opacity-0'}`}
          />
          {impact && (
            <>
              <span className="roll-ring" style={{ borderColor: glow }} />
              {landed &&
                Array.from({ length: sparks }, (_, i) => {
                  const a = (i / sparks) * Math.PI * 2 + (seed % 7)
                  const d = 90 + ((i * 37) % 60) + (crit === 'high' ? 50 : 0)
                  return (
                    <span
                      key={i}
                      className="roll-spark"
                      style={{
                        background: glow,
                        color: glow,
                        ['--dx' as string]: `${Math.cos(a) * d}px`,
                        ['--dy' as string]: `${Math.sin(a) * d}px`,
                        animationDelay: `${(i % 4) * 30}ms`,
                      }}
                    />
                  )
                })}
            </>
          )}
          <div ref={motionRef} className="roll-stage" style={still ? undefined : { opacity: 0 }}>
            <div ref={spinRef} className="roll-stage">
              {coin ? (
                <Coin heads={t('Heads')} tails={t('Tails')} />
              ) : cube ? (
                <Cube theme={theme} />
              ) : (
                <FlatDie sides={sides} value={shown} theme={theme} uid={String(seed)} />
              )}
            </div>
          </div>
        </div>
        <div className="mt-5 h-28 text-center">
          {landed && (
            <div className="animate-[roll-pop_0.45s_cubic-bezier(.2,1.6,.4,1)_both]">
              <p
                className="font-display text-7xl leading-none"
                style={{ color: glow, textShadow: `0 0 24px ${glow}88, 0 4px 0 #000` }}
              >
                {coin ? (n === 1 ? t('Heads') : t('Tails')) : n}
              </p>
              {crit && (
                <p className="mt-1 text-lg font-bold tracking-wide uppercase" style={{ color: glow }}>
                  {crit === 'high' ? t('Natural 20!') : t('Natural 1…')}
                </p>
              )}
              <p className="mt-2 inline-flex items-center gap-1 text-xs text-parchment/55">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                {t('Drawn by the server and saved in the log')}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
