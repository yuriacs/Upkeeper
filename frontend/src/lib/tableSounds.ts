/*
 * Sons da mesa virtual, sintetizados com Web Audio (sem arquivos para baixar).
 * O navegador só libera o áudio depois do primeiro clique na página; antes disso os sons são ignorados.
 */
import type { LogItem } from '../hooks/useTableSocket'
import { readJSON, writeJSON } from './storage'

export type SoundName =
  | 'coin' | 'dice' | 'shuffle' | 'draw' | 'reveal' | 'chat' | 'join' | 'turn' | 'win' | 'shake' | 'target'
  | 'alert' | 'ok' | 'play' | 'your_turn'

const MUTE_KEY = 'precon-draft:table-muted'
let muted = readJSON<boolean>(MUTE_KEY, false)
let ctx: AudioContext | null = null

export const isMuted = () => muted
export function setMuted(value: boolean) {
  muted = value
  writeJSON(MUTE_KEY, value)
}

function audio(): AudioContext | null {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return null
  ctx ??= new AudioContext()
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

/** Um tom curto com ataque rápido e queda exponencial. */
function tone(ac: AudioContext, freq: number, start: number, dur: number, gain = 0.2, type: OscillatorType = 'sine') {
  const osc = ac.createOscillator()
  const g = ac.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, start)
  g.gain.setValueAtTime(0.0001, start)
  g.gain.exponentialRampToValueAtTime(gain, start + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur)
  osc.connect(g).connect(ac.destination)
  osc.start(start)
  osc.stop(start + dur + 0.02)
}

/** Ruído filtrado (dados rolando, cartas embaralhando). */
function noise(ac: AudioContext, start: number, dur: number, gain = 0.15, freq = 2500) {
  const buffer = ac.createBuffer(1, Math.ceil(ac.sampleRate * dur), ac.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length)
  const src = ac.createBufferSource()
  src.buffer = buffer
  const filter = ac.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = freq
  const g = ac.createGain()
  g.gain.value = gain
  src.connect(filter).connect(g).connect(ac.destination)
  src.start(start)
}

/** O som de um registro do log na mesa (null: sem som) */
export function logSound(e: LogItem): SoundName | null {
  if (e.kind === 'roll') return e.sides === 2 ? 'coin' : 'dice'
  if (e.kind === 'shuffle' || e.kind === 'mulligan') return 'shuffle'
  if (e.kind === 'chat' || e.kind === 'spectator_chat') return 'chat'
  if (e.kind === 'signal') return e.what === 'alert' ? 'alert' : 'ok'
  // Carta entrando no campo (ou ficha criada): a carta batendo na mesa
  if ((e.kind === 'move' || e.kind === 'move_many' || e.kind === 'draw_to') && e.to === 'battlefield') return 'play'
  if (e.kind === 'token' || e.kind === 'clone' || (e.kind === 'card_action' && e.act === 'tokens')) return 'play'
  const sounds: Record<string, SoundName> = {
    reveal: 'reveal',
    joined: 'join',
    turn: 'turn',
    game_over: 'win',
    achievement: 'win',
    draw: 'draw',
    shake: 'shake',
  }
  return sounds[e.kind] ?? null
}

export function playSound(name: SoundName) {
  if (muted) return
  const ac = audio()
  if (!ac) return
  const t = ac.currentTime + 0.01
  switch (name) {
    case 'coin':
      // "tim" metálico duas vezes
      tone(ac, 1760, t, 0.35, 0.12, 'triangle')
      tone(ac, 2637, t + 0.08, 0.5, 0.08, 'sine')
      break
    case 'dice':
      // batidas curtas e irregulares
      for (let i = 0; i < 6; i++)
        noise(ac, t + i * 0.07 + Math.random() * 0.03, 0.05, 0.25, 1200 + Math.random() * 1500)
      break
    case 'shuffle':
      for (let i = 0; i < 10; i++) noise(ac, t + i * 0.035, 0.04, 0.12, 3500)
      break
    case 'shake':
      // chocalho rápido e um "toc" grave
      for (let i = 0; i < 5; i++) noise(ac, t + i * 0.055, 0.04, 0.2, 900 + (i % 2) * 700)
      tone(ac, 196, t, 0.18, 0.1, 'triangle')
      break
    case 'target':
      // "fiu" subindo: a seta saindo
      tone(ac, 440, t, 0.12, 0.08, 'sawtooth')
      tone(ac, 880, t + 0.06, 0.2, 0.08, 'triangle')
      break
    case 'draw':
      noise(ac, t, 0.08, 0.1, 5000)
      break
    case 'play':
      // carta batendo na mesa: um deslize curto e um "toc" grave e abafado
      noise(ac, t, 0.06, 0.12, 2200)
      noise(ac, t + 0.05, 0.05, 0.22, 500)
      tone(ac, 130.81, t + 0.05, 0.12, 0.12, 'triangle')
      break
    case 'reveal':
      tone(ac, 523.25, t, 0.4, 0.12)
      tone(ac, 659.25, t + 0.1, 0.4, 0.12)
      tone(ac, 783.99, t + 0.2, 0.6, 0.12)
      break
    case 'alert':
      // dois bipes agudos e insistentes: "espera!"
      tone(ac, 988, t, 0.12, 0.14, 'square')
      tone(ac, 988, t + 0.16, 0.12, 0.14, 'square')
      break
    case 'ok':
      // dois tons descendo, suaves: "pode seguir"
      tone(ac, 784, t, 0.18, 0.08)
      tone(ac, 587.33, t + 0.1, 0.25, 0.08)
      break
    case 'chat':
      tone(ac, 880, t, 0.15, 0.08)
      tone(ac, 1320, t + 0.07, 0.2, 0.06)
      break
    case 'turn':
      // gongo curto: passou o turno
      tone(ac, 220, t, 0.8, 0.14, 'triangle')
      tone(ac, 330, t + 0.02, 0.7, 0.08, 'sine')
      break
    case 'win':
      // fanfarra curta
      ;[523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(ac, f, t + i * 0.12, 0.5, 0.12, 'triangle'))
      tone(ac, 1046.5, t + 0.5, 1.1, 0.1, 'sine')
      break
    case 'your_turn':
      // três tons subindo, mais altos que os da mesa: chama quem está em outra aba
      ;[523.25, 659.25, 880].forEach((f, i) => tone(ac, f, t + i * 0.14, 0.35, 0.16, 'triangle'))
      break
    case 'join':
      tone(ac, 392, t, 0.25, 0.08)
      tone(ac, 587.33, t + 0.12, 0.35, 0.08)
      break
  }
}
